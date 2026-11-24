// Vite's `?raw` suffix imports a file as a string (used for the committed jar files).
declare module "*?raw" {
  const text: string;
  export default text;
}
