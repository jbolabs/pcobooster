import { throwIfAborted } from "@pcobooster/client/abort-signal";
import { Directory, File, Paths } from "expo-file-system";

import {
  launchOptions,
  releaseSmokeNetwork,
} from "../../harness/current-launch-options";
import { fixturePreviewStore } from "../../harness/fixture-preview-files";
import { downloadPreview } from "./native-preview";
import { guardPreviewStore } from "./preview-store";
import type { PreviewStore } from "./preview-store";
import { PreviewError, previewScopeFolder, secureUrl } from "./previews";

/**
 * Previews on the device: `Caches/song-previews/<scope>/<folder>/<name>`. The system may purge
 * the cache at any time; a read whose file is gone counts as stale and writes it again
 * (`preview-reads.ts`). Only the account context on screen keeps a folder: writing for one scope
 * removes every other scope's, and forgetting an account removes them all, including any
 * preview still on its way (`guardPreviewStore`).
 */
const ROOT_FOLDER = "song-previews";

const root = () => new Directory(Paths.cache, ROOT_FOLDER);

const removeOtherScopes = (keep: string) => {
  const folder = root();
  if (!folder.exists) {
    return;
  }
  for (const entry of folder.list()) {
    if (entry.name !== keep) {
      entry.delete();
    }
  }
};

/** An empty folder for one preview, so a new version never mixes with the last. */
const freshFolder = (scope: string, folder: string): Directory => {
  const scopeFolder = previewScopeFolder(scope);
  removeOtherScopes(scopeFolder);
  const directory = new Directory(root(), scopeFolder, folder);
  if (directory.exists) {
    directory.delete();
  }
  directory.create({ intermediates: true });
  return directory;
};

/** The folder of a saved preview, or null for anything outside the previews folder. */
const previewFolderOf = (uri: string): Directory | null => {
  const rootUri = root().uri.replace(/\/?$/u, "/");
  const folder = uri.slice(0, uri.lastIndexOf("/"));
  return uri.startsWith(rootUri) && folder.length > rootUri.length
    ? new Directory(folder)
    : null;
};

const deviceStore: PreviewStore = {
  writeBase64: (scope, folder, name, base64) => {
    const file = new File(freshFolder(scope, folder), name);
    file.create();
    file.writeSync(base64, { encoding: "base64" });
    return file.uri;
  },
  download: async (scope, folder, name, url, signal) => {
    // The link is Planning Center's signed one; it never carries this app's credentials.
    if (secureUrl(url.href) === null) {
      throw new PreviewError("insecure-link");
    }
    throwIfAborted(signal);
    const directory = freshFolder(scope, folder);
    const file = new File(directory, name);
    try {
      await downloadPreview(url, file.uri, signal);
    } catch (error) {
      directory.delete();
      throw error;
    }
    return file.uri;
  },
  // The system player streams the signed link; nothing is saved.
  playable: async (_scope, _folder, _name, url) =>
    await Promise.resolve(url.href),
  exists: (uri) => {
    try {
      return previewFolderOf(uri) !== null && new File(uri).exists;
    } catch {
      return false;
    }
  },
  discard: (uri) => {
    try {
      const folder = previewFolderOf(uri);
      if (folder?.exists === true) {
        folder.delete();
      }
    } catch {
      // Already gone, or never a saved preview.
    }
  },
  clear: () => {
    try {
      const folder = root();
      if (folder.exists) {
        folder.delete();
      }
    } catch {
      // Each account context reads only its own scope's folder, and the system purges caches.
    }
  },
};

/** The device's files; fixture launches draw the attachment fixtures from bundled bytes. */
const previews = guardPreviewStore(
  launchOptions.mock || releaseSmokeNetwork !== null
    ? fixturePreviewStore(deviceStore)
    : deviceStore
);

export const previewFiles = previews.files;

/** Removes every saved preview, for every account, and refuses any still on its way. */
export const clearSongPreviews = (): void => {
  previews.clear();
};
