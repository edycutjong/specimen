/// <reference types="vite/client" />
/**
 * The GitHub repo is private until the human flips it public at submission. Until then the
 * cabinet shows the path as plain text instead of a link that would 404 for a judge.
 * Set `VITE_REPO_PUBLIC=1` for the production build after the flip, then redeploy.
 */
export function repoIsPublic(): boolean {
  return import.meta.env.VITE_REPO_PUBLIC === "1";
}
