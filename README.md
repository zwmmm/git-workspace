# Git workspace for Paseo

Browse GitHub and GitLab repositories, create a remote repository, or import a folder into Paseo. The sidebar entry follows the app language: **Repos** in English and **仓库** in Simplified Chinese.

- Compact repository list with search, provider and local-state filters.
- Clone and create a workspace using the default settings, with per-repository options when needed.
- Create a GitHub repository under the signed-in personal account, or choose a personal namespace or permitted group for GitLab. Repositories are private unless you enable public visibility.
- Import a folder from the connected host. Existing workspaces for the same directory are opened again.
- Open the repository browser from the sidebar, Command Center, or `/git`.

## Requirements

Paseo 0.17.4 or later on both the app and daemon. The daemon host needs Git and, for the corresponding provider, an authenticated GitHub CLI (`gh`) or GitLab CLI (`glab`). Folder import works without a GitHub or GitLab account.

## Install from GitHub

```sh
paseo plugin add git:zwmmm/git-workspace --ref v1.2.2
```

This installs directly from GitHub. It does not require or imply a listing in the Paseo plugin registry.

## Settings

Open the plugin settings to configure the clone root (`~/Projects` by default), SSH/HTTPS, Local/Worktree, and GitLab instance URL. Repositories are stored under `<clone root>/<host>/<owner>/<repository>`.

A new remote repository includes an initial README. GitHub uses the signed-in personal account. GitLab adds a creation-location selector with the personal namespace and groups where the current user can create projects, including subgroups. Group paths are displayed in full and permissions are checked again before creation. Once created, it is cloned and opened with the default workspace settings. If cloning fails, retry continues from the existing remote repository.

Folder import uses the original host directory. It does not copy files, initialize Git, or upload anything. On a mobile or remote client, browse selects directories on the connected daemon host.

## Data access

Repository discovery and creation use `gh` and `glab` on the daemon host, contacting GitHub or the configured GitLab instance. Git clone uses the selected protocol. Repository metadata is cached in `~/.paseo/git-workspace-cache.json` on that host. The plugin does not collect a separate access token or install CLI tools automatically.

The plugin runs with Paseo's trusted plugin permissions, including access to host files and processes. It does not send prompts or repository contents to an agent provider.

## Development

```sh
npm ci
npm test
npm run typecheck
paseo plugin install /absolute/path/to/git-workspace
paseo plugin reload git-workspace
```

## License

MIT. The GitHub and GitLab icon paths are adapted from Paseo's Apache-2.0 source; see [NOTICE](NOTICE).
