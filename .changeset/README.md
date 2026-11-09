# Release notes

Run `pnpm changeset` for a change that users need to hear about. Select
`@centrst/blind`, choose the version bump and describe the change. Commit the
generated Markdown file with the change. Documentation and tooling changes
that do not change the package's behavior need no changeset.

The release PR workflow combines pending notes into one version bump and
changelog. Merging that PR does not publish a package. See
[RELEASING.md](../RELEASING.md) for verification and publishing.
