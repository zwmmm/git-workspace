# Git workspace

Browse GitHub and GitLab repositories in a compact list, clone them into Paseo workspaces, create a new repository under your signed-in personal account or a permitted GitLab group, or import a directory from the connected host. Open it from Repos in the sidebar, the Command Center, or `/git`.

New remote repositories are private by default and include a README. Creation uses the host's authenticated account; GitLab also supports selecting a group or subgroup with project-creation permission. It then clones the repository and opens a workspace with your default settings. Folder import uses the existing directory without copying files, initializing Git, or uploading it. When a workspace already uses that directory, it opens that workspace.

Both the Paseo app and daemon require version 0.17.4 or later. GitHub and GitLab operations require Git and an authenticated `gh` or `glab` on the daemon host. Folder import does not require a provider account. Configure the GitLab instance, clone root, SSH/HTTPS protocol, and Local/Worktree default in plugin settings.

The plugin contacts GitHub or the configured GitLab instance through those CLI tools and uses Git to clone repositories. Metadata is cached at `~/.paseo/git-workspace-cache.json` on the host. It does not request another access token, install CLI tools automatically, or send prompts or repository contents to an agent provider. On a mobile or remote client, folder browsing reads directories on the connected host.

Discovery currently reads up to 30 repositories per provider. Creating a GitHub repository in an organization, publishing an existing folder, and selecting a remote branch are not supported by the creation form.
