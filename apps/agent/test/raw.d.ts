// Vite's ?raw imports (file contents as a string), used by tests only.
declare module "*?raw" {
  const content: string;
  export default content;
}
