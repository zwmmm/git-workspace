# Git Workspace for Paseo

Search, clone, and launch Paseo workspaces from GitHub and GitLab repositories directly in Paseo.

![Git Workspace Surface](https://raw.githubusercontent.com/zwmmm/git-workspace/main/assets/git-workspace-surface.png)

## Features

- **Repository discovery**: List and search across your GitHub and GitLab repositories.
- **One-click workspace creation**: Clone repositories and open them in Paseo as worktrees or local checkouts.
- **Integrated surfaces**:
  - Sidebar item: Browse repositories and clone status in a dedicated panel.
  - ⌘K Command Center: Quick access to clone and create workspaces.
  - Slash command `/git`: Open the repository explorer from the composer.
- **Customizable settings**: Configure default clone directory (`~/Projects`), SSH/HTTPS protocol, default isolation mode, and self-hosted GitLab URLs.

![Git Workspace Settings](https://raw.githubusercontent.com/zwmmm/git-workspace/main/assets/git-workspace-settings.png)

## Requirements

- Paseo ≥ 0.8.0
- GitHub CLI (`gh`) and/or GitLab CLI (`glab`) installed and authenticated.

## Installation

```bash
paseo plugin add zwmmm/git-workspace
```

## License

MIT
