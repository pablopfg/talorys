import { type FormEvent, useMemo, useState } from "react";
import { type MfaSetup, RECOVERY_CODES_LOW } from "@talorys/shared";
import qrcode from "qrcode-generator";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Download, KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, Dialog, Input, Label, Spinner } from "./ui";
import { keys, useApiMutation, useMfaStatus } from "../hooks/queries";
import { errorMessage, useToast } from "../hooks/toast";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/utils";
import { useI18n } from "../lib/i18n";

/** The otpauth link as a QR code, drawn as SVG paths: dark on white whatever the theme, with the quiet zone apps expect. */
function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4},${r + 4}h1v1h-1z`;
    return { size: n + 8, path: d };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="h-48 w-48 rounded-lg" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

/** Shows the new recovery codes once, with copy and download; they can't be seen again. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const text = codes.join("\n");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast(t("mfa.codesCopied"));
    } catch {
      toast(t("common.somethingWentWrong"), "error");
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([`${t("mfa.codesFileHeader")}\n\n${text}\n`], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "talorys-recovery-codes.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="space-y-4 px-5 py-4">
      <p className="text-sm leading-6 text-fg-muted">{t("mfa.codesIntro")}</p>
      <ul className="grid grid-cols-1 gap-1 rounded-lg bg-muted p-3 font-mono text-sm sm:grid-cols-2">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => void copy()}>
          <Copy className="h-3.5 w-3.5" /> {t("mfa.copy")}
        </Button>
        <Button variant="outline" size="sm" onClick={download}>
          <Download className="h-3.5 w-3.5" /> {t("mfa.download")}
        </Button>
        <Button size="sm" onClick={onDone}>
          {t("mfa.savedCodes")}
        </Button>
      </div>
    </div>
  );
}

/** Asks for a code before turning the second step off or making new recovery codes. */
function CodeDialog({
  open,
  title,
  description,
  confirmLabel,
  allowRecovery,
  danger,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  allowRecovery: boolean;
  danger?: boolean;
  onSubmit: (code: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setCode("");
    setError(null);
    onClose();
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(code.trim());
      setCode("");
    } catch (err) {
      setError(errorMessage(err, t("common.somethingWentWrong")));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={close} title={title}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm leading-6 text-fg-muted">{description}</p>
        <div>
          <Label htmlFor="mfa-dialog-code" hint={allowRecovery ? t("mfa.codeOrRecovery") : undefined}>
            {t("login.code")}
          </Label>
          <Input
            id="mfa-dialog-code"
            autoComplete="one-time-code"
            inputMode={allowRecovery ? "text" : "numeric"}
            autoFocus
            maxLength={40}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} loading={busy} disabled={!code.trim()}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Settings → Security: two-step sign-in with an authenticator app. Turning it on shows a QR code
 * and asks for a first code; the recovery codes are shown once. Every change asks for the
 * password first (the server's recent-auth check) and signs out the other sessions.
 */
export function TwoFactorCard({ timezone }: { timezone: string }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const toast = useToast();
  const qc = useQueryClient();
  const status = useMfaStatus();
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [dialog, setDialog] = useState<"disable" | "regenerate" | null>(null);

  const begin = useApiMutation(() => api<MfaSetup>("/auth/mfa/setup", { method: "POST", body: {} }), {
    onSuccess: (s) => {
      setSetup(s);
      setCode("");
      setSetupError(null);
    },
  });
  const [enabling, setEnabling] = useState(false);
  // Turning it on or off signs out the other sessions and adds a line to the activity.
  const refresh = () => Promise.all([keys.mfa, keys.sessions, keys.authActivity].map((key) => qc.invalidateQueries({ queryKey: key })));

  async function submitSetup(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setEnabling(true);
    setSetupError(null);
    try {
      const r = await api<{ recovery_codes: string[] }>("/auth/mfa/enable", { method: "POST", body: { code: code.trim() } });
      setSetup(null);
      setCode("");
      setCodes(r.recovery_codes);
      toast(t("mfa.enabled"));
      void refresh();
    } catch (err) {
      setSetupError(errorMessage(err, t("common.somethingWentWrong")));
    } finally {
      setEnabling(false);
    }
  }
  async function disable(value: string) {
    await api("/auth/mfa/disable", { method: "POST", body: { code: value } });
    setDialog(null);
    toast(t("mfa.disabled"));
    void refresh();
  }
  async function regenerate(value: string) {
    const r = await api<{ recovery_codes: string[] }>("/auth/mfa/recovery-codes", { method: "POST", body: { code: value } });
    setDialog(null);
    setCodes(r.recovery_codes);
    void refresh();
  }

  const s = status.data;
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">{t("mfa.title")}</h2>
      <Card>
        {status.isLoading || !s ? (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        ) : codes ? (
          <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
        ) : setup ? (
          <form onSubmit={submitSetup} className="space-y-4 px-5 py-4">
            <p className="text-sm leading-6 text-fg-muted">{t("mfa.scan")}</p>
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              <QrCode text={setup.otpauth_uri} label={t("mfa.qrLabel")} />
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <p className="text-xs text-fg-subtle">{t("mfa.manualKey")}</p>
                  <code className="mt-1 block break-all rounded bg-muted px-2 py-1 font-mono text-sm">{setup.secret.match(/.{1,4}/g)!.join(" ")}</code>
                </div>
                <div>
                  <Label htmlFor="mfa-setup-code">{t("mfa.firstCode")}</Label>
                  <Input
                    id="mfa-setup-code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={10}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                  {setupError && (
                    <p role="alert" className="mt-2 text-sm text-danger">
                      {setupError}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" loading={enabling} disabled={!code.trim()}>
                {t("mfa.turnOn")}
              </Button>
            </div>
          </form>
        ) : s.enabled ? (
          <div className="divide-y divide-border">
            <div className="flex items-start gap-3 px-5 py-4">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              <div className="min-w-0 text-sm leading-6">
                <p className="font-medium">{t("mfa.on")}</p>
                {s.enabled_at && <p className="text-xs text-fg-subtle">{t("mfa.onSince", { date: formatDateTime(s.enabled_at, timezone, locale) })}</p>}
              </div>
            </div>
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm">
                <span className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-fg-subtle" /> {t("mfa.codesLeft", { count: s.recovery_codes_left })}
                  {s.recovery_codes_left <= RECOVERY_CODES_LOW && <Badge tone="warning">{t("mfa.codesLow")}</Badge>}
                </span>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setDialog("regenerate")}>
                  {t("mfa.regenerate")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDialog("disable")}>
                  {t("mfa.turnOff")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 px-5 py-4">
            <div role="status" className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              <div className="text-sm leading-6">
                <p className="font-medium">{t("mfa.off")}</p>
                <p className="text-fg-muted">{t("mfa.offHint")}</p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => begin.mutate(undefined)} loading={begin.isPending}>
                {t("mfa.setUp")}
              </Button>
            </div>
          </div>
        )}
      </Card>
      <CodeDialog
        open={dialog === "disable"}
        title={t("mfa.turnOffTitle")}
        description={t("mfa.turnOffMessage")}
        confirmLabel={t("mfa.turnOff")}
        allowRecovery
        danger
        onSubmit={disable}
        onClose={() => setDialog(null)}
      />
      <CodeDialog
        open={dialog === "regenerate"}
        title={t("mfa.regenerateTitle")}
        description={t("mfa.regenerateMessage")}
        confirmLabel={t("mfa.regenerate")}
        allowRecovery={false}
        onSubmit={regenerate}
        onClose={() => setDialog(null)}
      />
    </section>
  );
}
