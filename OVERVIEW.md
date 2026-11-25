# Git workspace

Browse GitHub and GitLab repositories, create a remote repository, or open a folder as a Paseo workspace. Find the plugin under **Repos** in English or **仓库** in Simplified Chinese, in the Command Center, or with `/git`.

## Browse repositories

Search by repository name or description and filter by provider or local status. Each row shows the provider and whether the repository is already on the host. Clone and open a workspace in one step, or use the row menu to choose Local or Worktree. Discovery reads up to 30 repositories per provider.

## Create a repository

Choose GitHub or GitLab and enter a repository name. The plugin uses the account already signed in on the host. GitHub creates under the personal account; GitLab lets you choose your personal namespace or a group or subgroup where you have permission to create projects. Group paths are shown in full and permissions are checked again before creation.

Repositories are private by default and include a README. After creation, the plugin clones the repository and opens a workspace using your default settings. If cloning fails, retry continues with the existing remote repository.

## Import a folder

Choose a directory on the connected host and open it as a workspace. Import uses the existing files without copying them, initializing Git, or uploading them. If a workspace already uses that directory, the plugin opens it again. Browsing from a mobile or remote client still reads directories on the daemon host.

## Setup and data access

The Paseo app and daemon require version 0.17.4 or later. GitHub and GitLab operations need Git and an authenticated `gh` or `glab` on the daemon host. Folder import does not require a provider account. Plugin settings control the GitLab instance, clone root, SSH/HTTPS protocol, and Local/Worktree default.

The plugin contacts GitHub or the configured GitLab instance through those CLI tools and uses Git to clone repositories. Metadata is cached at `~/.paseo/git-workspace-cache.json` on the host. It does not request another access token, install CLI tools automatically, or send prompts or repository contents to an agent provider. GitHub organization creation and publishing an existing local folder are not supported by the creation form.
