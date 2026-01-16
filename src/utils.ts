import * as os from "os";
import { readFile } from "fs/promises";
import JSON5 from "json5";
import { Uri, workspace, FileSystemError } from "vscode";

import { logger } from "./extension";

const getConfigPaths = (
  appName: string,
  file: string,
  profileId?: string | null
): string[] => {
  const paths: string[] = [];

  // If profileId provided and not default, use profile path
  if (profileId && profileId !== "__default__profile__") {
    const baseFolder =
      os.platform() === "win32"
        ? process.env.APPDATA
        : os.platform() === "darwin"
          ? `${process.env.HOME}/Library/Application Support`
          : `${process.env.HOME}/.config`;

    const separator = os.platform() === "win32" ? "\\" : "/";
    paths.push(`${baseFolder}${separator}${appName}${separator}User${separator}profiles${separator}${profileId}${separator}${file}`);
  }

  // Add default paths
  switch (os.platform()) {
    case "win32":
      paths.push(
        `${process.env.APPDATA}\\${appName}\\User\\${file}`,
        `${process.env.USERPROFILE}\\AppData\\Roaming\\${appName}\\User\\${file}`
      );
      break;
    case "darwin":
      paths.push(
        `${process.env.HOME}/Library/Application Support/${appName}/User/${file}`,
        `${os.homedir()}/Library/Application Support/${appName}/User/${file}`
      );
      break;
    default:
      paths.push(
        `${process.env.HOME}/.config/${appName}/User/${file}`,
        `${
          process.env.XDG_CONFIG_HOME || `${os.homedir()}/.config`
        }/${appName}/User/${file}`,
        `${os.homedir()}/.config/${appName}/User/${file}`
      );
  }

  return paths;
};

export async function pathExists(path: string): Promise<boolean> {
  try {
    await workspace.fs.stat(Uri.file(path));
    logger.info(`Found file at: ${path}`);
    return true;
  } catch (error) {
    return false;
  }
}

export const findConfigFile = async (
  appName: string,
  file: string,
  profileId?: string | null
): Promise<string> => {
  const possiblePaths = getConfigPaths(appName, file, profileId);
  for (const path of possiblePaths) {
    if (await pathExists(path)) {
      return Uri.file(path).fsPath;
    } else {
      continue;
    }
  }
  logger.error(
    `Could not find ${file} in any default location`,
    "utils.findConfigFile",
    true
  );
  throw FileSystemError.FileNotFound(
    `${file} does not exist in any of the configuration directories`
  );
};

/**
 * Get VS Code storage.json path for profile detection
 */
export function getStoragePath(appName: string): string {
  const baseFolder =
    os.platform() === "win32"
      ? process.env.APPDATA
      : os.platform() === "darwin"
        ? `${process.env.HOME}/Library/Application Support`
        : `${process.env.HOME}/.config`;

  const separator = os.platform() === "win32" ? "\\" : "/";
  return `${baseFolder}${separator}${appName}${separator}User${separator}globalStorage${separator}storage.json`;
}

/**
 * Parse VS Code storage.json to get active profile info
 */
export async function getActiveProfileInfo(
  appName: string
): Promise<{ id: string | null; name: string | null } | null> {
  try {
    const storagePath = getStoragePath(appName);
    const exists = await pathExists(storagePath);

    if (!exists) {
      return { id: "__default__profile__", name: "Default" };
    }

    const content = await readFile(storagePath, "utf-8");
    const storage = JSON5.parse(content);

    // Check if workspace has a specific profile
    if (storage.profileAssociations?.workspaces) {
      const workspaceUri = workspace.workspaceFolders?.[0]?.uri.toString();
      if (workspaceUri && storage.profileAssociations.workspaces[workspaceUri]) {
        const profileId = storage.profileAssociations.workspaces[workspaceUri];
        const profile = storage.userDataProfiles?.find((p: any) => p.location === profileId);
        return { id: profileId, name: profile?.name || profileId };
      }
    }

    return { id: "__default__profile__", name: "Default" };
  } catch (error) {
    logger.warn(
      `Could not detect active profile, using default: ${error}`,
      false,
      "utils.getActiveProfileInfo"
    );
    return { id: "__default__profile__", name: "Default" };
  }
}
