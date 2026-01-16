# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sync Everything is a VS Code extension that synchronizes settings, extensions, and keybindings across devices using GitHub Gists as storage. The extension uses TypeScript with webpack for bundling.

## Development Commands

### Building
- `npm run compile` - Compile TypeScript with webpack (development mode)
- `npm run package` - Production build with webpack
- `npm run watch` - Watch mode for development

### Testing & Quality
- `npm run lint` - Run ESLint on src directory
- `npm run test` - Run tests (requires `npm run pretest` setup)
- `npm run compile-tests` - Compile test files
- `npm run watch-tests` - Watch mode for test compilation

### Publishing
- `npm run vscode:prepublish` - Production package before publishing

## Architecture

The extension follows a service-oriented architecture with three main layers:

### Entry Point
- `src/extension.ts` - Main activation file that orchestrates service initialization, command registration, and manages the status bar UI

### Core Services
- `src/core/gist.ts` (GistService) - Handles all GitHub Gist operations, authentication via VS Code's built-in GitHub auth, profile CRUD operations
- `src/core/synceverything.ts` (SyncEverything) - Manages local configuration files (settings.json, keybindings.json), extension installation/uninstallation, profile reading from local VS Code instance
- `src/core/logger.ts` (Logger) - Centralized logging system with output channel integration and user notifications

### Data Models
- `src/models/interfaces.ts` - TypeScript interfaces for all data structures (IProfile, IGist, ISettings, IKeybinds, etc.)

### Utilities
- `src/utils.ts` - Cross-platform configuration file discovery and path resolution

## Key Design Patterns

**Profile-Based Storage**: Uses a "master gist" as a registry containing multiple profiles. Each profile is a complete configuration snapshot stored as a JSON file within the master gist.

**Service Initialization**: Services are initialized with dependency injection, each receiving the Logger instance for consistent logging throughout.

**Command Registration**: All commands are registered in `extension.ts` during activation and properly disposed during deactivation.

**Cross-Platform Support**: Automatically detects VS Code vs Cursor editor and handles platform-specific configuration file paths (Windows, macOS, Linux). Falls back to manual path selection when automatic detection fails.

## Authentication

Uses VS Code's built-in GitHub authentication provider (`vscode.authentication.getSession('github', ['gist'], ...)`). Tokens are stored securely in VS Code's credential store - only `gist` scope permissions are requested.

## Important Notes

- Comments in `settings.json` and `keybindings.json` cannot be preserved during sync operations (JSON limitation)
- All gists are private for user privacy
- Extension sync includes smart conflict resolution with user confirmation before installing/uninstalling
- The extension activates on `onStartupFinished` event (not immediately on startup)
