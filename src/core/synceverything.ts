import { readFile } from "fs/promises";
import JSON5 from "json5";
import {
  Extension,
  ExtensionContext,
  ProgressLocation,
  Uri,
  commands,
  env,
  extensions,
  window,
  workspace,
} from "vscode";
import { IKeybinds, IProfile, ISettings } from "../models/interfaces";
import { findConfigFile, getActiveProfileInfo } from "../utils";
import Logger from "./logger";

export default class SyncEverything {
  context: ExtensionContext;
  logger: Logger;

  // Profile tracking properties
  public activeProfileId: string | null = null;
  public activeProfileName: string | null = null;
  public appName!: string; // Definitely assigned in initialize()

  private constructor(logger: Logger, context: ExtensionContext) {
    this.logger = logger;
    this.context = context;
  }

  public static async initialize(
    logger: Logger,
    context: ExtensionContext
  ): Promise<SyncEverything | undefined> {
    const appName: string = env.appName.includes("Antigravity")
      ? "Antigravity"
      : env.appName.includes("Trae")
        ? "Trae"
        : env.appName.includes("Code")
          ? env.appName.includes("Insiders")
            ? "Code - Insiders"
            : "Code"
          : "Cursor";

    const instance = new SyncEverything(logger, context);
    instance.appName = appName;

    // Detect active profile
    try {
      const profileInfo = await getActiveProfileInfo(appName);
      if (profileInfo) {
        instance.activeProfileId = profileInfo.id;
        instance.activeProfileName = profileInfo.name;
        logger.info(
          `Detected active profile: ${profileInfo.name} (${profileInfo.id})`
        );
      }
    } catch (error) {
      logger.warn(
        "Could not detect profile, using default",
        false,
        "SyncEverything.initialize"
      );
      instance.activeProfileId = "__default__profile__";
      instance.activeProfileName = "Default";
    }

    // Validate we can find config files (but don't cache the paths)
    try {
      await findConfigFile(appName, "settings.json", instance.activeProfileId);
      await findConfigFile(appName, "keybindings.json", instance.activeProfileId);
    } catch (error) {
      logger.error(
        "Failed to automatically find configuration files - opening file picker",
        "SyncEverything.initialize",
        true
      );
      try {
        const settingsPath = await SyncEverything.setManualPath("settings");
        const keybindingsPath = await SyncEverything.setManualPath("keybindings");
        // Store manual paths for fallback
        context.globalState.update("manualSettingsPath", settingsPath);
        context.globalState.update("manualKeybindingsPath", keybindingsPath);
      } catch (error) {
        logger.error(
          "Configuration files are required for SyncEverything to work, please reactivate extension and select correct configuration files.",
          "SyncEverything.initialize",
          true
        );
        return undefined;
      }
    }
    return instance;
  }
  public static async setManualPath(
    t: "keybindings" | "settings",
    title?: string
  ): Promise<string> {
    try {
      const manualPath = (await window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { "JSON files": ["json"] },
        title: title ? title : `Select ${t}.json file`,
      }))!;
      return manualPath[0].fsPath;
    } catch (error) {
      throw error;
    }
  }

  public async getActiveProfile(): Promise<Partial<IProfile>> {
    // Re-detect active profile each time (in case user switched profiles)
    try {
      const profileInfo = await getActiveProfileInfo(this.appName);
      if (profileInfo) {
        this.activeProfileId = profileInfo.id;
        this.activeProfileName = profileInfo.name;
        this.logger.info(
          `Current active profile: ${profileInfo.name} (${profileInfo.id})`
        );
      }
    } catch (error) {
      this.logger.warn(
        "Could not re-detect profile, using cached value",
        false,
        "SyncEverything.getActiveProfile"
      );
    }

    const settings = (await this.readConfigFile<ISettings>("settings"))!;
    const keybinds = (await this.readConfigFile<IKeybinds[]>("keybindings"))!;
    const exts: string[] = this.getExtensions()!;

    return {
      settings: settings,
      extensions: exts,
      keybindings: keybinds,
      // Profile metadata
      sourceAppName: this.appName,
      sourceProfileId: this.activeProfileId,
      sourceProfileName: this.activeProfileName,
    } as Partial<IProfile>;
  }

  public async updateLocalProfile(profile: IProfile) {
    // Always get the current path dynamically
    const settingsPath: string = await findConfigFile(
      this.appName,
      "settings.json",
      this.activeProfileId
    );
    await this.writeConfigFile(settingsPath, profile.settings);

    const keybindingsPath: string = await findConfigFile(
      this.appName,
      "keybindings.json",
      this.activeProfileId
    );
    await this.writeConfigFile(keybindingsPath, profile.keybindings);

    await this.installExtensions(profile.extensions);
  }

  public async createNewProfileFromSync(profile: IProfile): Promise<void> {
    // 1. Ask user for new profile name
    const profileName = await window.showInputBox({
      prompt: "Enter name for the new profile",
      placeHolder: profile.profileName || "My Profile",
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return "Profile name cannot be empty";
        }
        return null;
      },
    });

    if (!profileName) {
      this.logger.info("Profile creation cancelled by user");
      return;
    }

    try {
      // 2. Generate unique profile ID
      const profileId = this.generateProfileId();
      const appName = env.appName.includes("Antigravity")
        ? "Antigravity"
        : env.appName.includes("Trae")
          ? "Trae"
          : env.appName.includes("Code")
            ? "Code"
            : "Cursor";

      const baseFolder =
        process.platform === "win32"
          ? process.env.APPDATA
          : process.platform === "darwin"
            ? `${process.env.HOME}/Library/Application Support`
            : `${process.env.HOME}/.config`;

      const separator = process.platform === "win32" ? "\\" : "/";

      // 3. Create profile directory
      const profilePath = `${baseFolder}${separator}${appName}${separator}User${separator}profiles${separator}${profileId}`;
      await workspace.fs.createDirectory(Uri.file(profilePath));

      // 4. Write settings to new profile
      const settingsPath = `${profilePath}${separator}settings.json`;
      await this.writeConfigFile(settingsPath, profile.settings);

      // 5. Write keybindings to new profile
      const keybindingsPath = `${profilePath}${separator}keybindings.json`;
      await this.writeConfigFile(keybindingsPath, profile.keybindings);

      // 6. Install extensions
      await this.installExtensions(profile.extensions);

      // 7. Register profile in storage.json
      await this.registerProfileInStorage(profileId, profileName, appName);

      this.logger.info(`Created new profile: ${profileName} (${profileId})`);
      window.showInformationMessage(
        `Profile "${profileName}" created! Switch to it in your editor settings.`
      );
    } catch (error) {
      this.logger.error(
        `Failed to create new profile`,
        "SyncEverything.createNewProfileFromSync",
        true,
        error
      );
      throw error;
    }
  }

  private generateProfileId(): string {
    // Generate 8-character hex ID
    return Array.from({ length: 8 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join("");
  }

  private async registerProfileInStorage(
    profileId: string,
    profileName: string,
    appName: string
  ): Promise<void> {
    try {
      const { getStoragePath } = await import("../utils");
      const storagePath = getStoragePath(appName);

      const content = await readFile(storagePath, "utf-8");
      const storage = JSON5.parse(content);

      if (!storage.userDataProfiles) {
        storage.userDataProfiles = [];
      }

      storage.userDataProfiles.push({
        location: profileId,
        name: profileName,
      });

      await workspace.fs.writeFile(
        Uri.file(storagePath),
        Buffer.from(JSON.stringify(storage, null, 2), "utf-8")
      );

      this.logger.info(
        `Registered profile "${profileName}" in storage.json`
      );
    } catch (error) {
      this.logger.warn(
        `Could not register profile in storage.json: ${error}`,
        false,
        "SyncEverything.registerProfileInStorage"
      );
    }
  }

  private async readConfigFile<T>(
    t: "keybindings" | "settings"
  ): Promise<T | undefined> {
    let path: string;

    try {
      // Check if manual path is set
      const manualPath = this.context.globalState.get<string>(`manual${t.charAt(0).toUpperCase() + t.slice(1)}Path`);
      if (manualPath) {
        path = manualPath;
      } else {
        // Always find the path dynamically based on current profile
        path = await findConfigFile(
          this.appName,
          `${t}.json`,
          this.activeProfileId
        );
      }
    } catch (error) {
      this.logger.error(
        `${t} file has not been set, cannot read from empty file path`,
        "SyncEverything.readConfigFile",
        true,
        error
      );
      return undefined;
    }
    try {
      const buffer = await readFile(path, "utf-8");
      return JSON5.parse(buffer) as T;
    } catch (error) {
      this.logger.error(
        `Failed to read ${t} file: ${path}`,
        "SyncEverything.readConfigFile",
        true,
        error
      );
      return undefined;
    }
  }
  private async writeConfigFile(path: string, data: string | any) {
    try {
      const content =
        typeof data === "string" ? data : JSON.stringify(data, null, 2);
      await workspace.fs.writeFile(
        Uri.file(path),
        Buffer.from(content, "utf8")
      );
      this.logger.info(`Configuration file updated: ${path}`);
    } catch (error) {
      this.logger.error(
        `Failed to write settings file: ${path}`,
        "SyncEverything.writeConfigFile",
        true,
        error
      );
      throw error;
    }
  }
  private getExtensions(): string[] {
    const excludeList =
      workspace
        .getConfiguration("synceverything")
        .get<string[]>("excludeExtensions") || [];
    return extensions.all
      .filter((ext: Extension<any>) => !ext.packageJSON.isBuiltin)
      .map((ext: Extension<any>) => ext.id)
      .filter((id) => !excludeList.includes(id));
  }
  private async installExtensions(remoteList: string[]) {
    const localList: string[] = this.getExtensions();
    const localSet = new Set(localList);
    const remoteSet = new Set(remoteList);

    const toInstall = remoteList.filter((id) => !localSet.has(id));
    const toDelete = localList.filter((id) => !remoteSet.has(id));

    if (toInstall.length === 0 && toDelete.length === 0) {
      window.showInformationMessage("Extensions are already in sync");
      return;
    }
    const confirmBeforeSync = workspace
      .getConfiguration("synceverything")
      .get<boolean>("confirmBeforeSync", true);
    if (confirmBeforeSync) {
      const action = await window.showWarningMessage(
        `Sync will:\n• Install ${toInstall.length} extensions\n• Remove ${toDelete.length} extensions\n\nContinue?`,
        { modal: true },
        "Yes",
        "Show Details",
        "Cancel"
      );

      if (action === "Show Details") {
        const details = [
          toInstall.length > 0 ? `To Install:\n${toInstall.join("\n")}` : "",
          toDelete.length > 0 ? `To Remove:\n${toDelete.join("\n")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        await window.showInformationMessage(details, {
          modal: true,
        });
        return;
      }

      if (action !== "Yes") {
        return;
      }
    }

    let needsReload = false;

    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: "Syncing Extensions",
        cancellable: false,
      },
      async (progress) => {
        const total = toInstall.length + toDelete.length;
        let completed = 0;

        // Process deletions first
        for (const id of toDelete) {
          try {
            progress.report({
              message: `Uninstalling ${id}...`,
              increment: (++completed / total) * 100,
            });
            await commands.executeCommand(
              "workbench.extensions.uninstallExtension",
              id
            );
            needsReload = true;
            this.logger.info(`Uninstalled extension: ${id}`);
          } catch (error) {
            this.logger.error(
              `Failed to uninstall ${id}`,
              "SyncEverything.installExtensions",
              false,
              error
            );
          }
        }

        // Then installations
        for (const id of toInstall) {
          try {
            progress.report({
              message: `Installing ${id}...`,
              increment: (++completed / total) * 100,
            });
            await commands.executeCommand(
              "workbench.extensions.installExtension",
              id
            );
            needsReload = true;
            this.logger.info(`Installed extension: ${id}`);
          } catch (error) {
            this.logger.error(
              `Failed to install ${id}`,
              "SyncEverything.installExtensions",
              false,
              error
            );
          }
        }
      }
    );

    if (needsReload) {
      const reload = await window.showInformationMessage(
        "Extension sync complete. Reload window to apply all changes?",
        "Reload",
        "Later"
      );
      if (reload === "Reload") {
        await commands.executeCommand("workbench.action.reloadWindow");
      }
    }
  }
}
