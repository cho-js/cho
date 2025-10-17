export default {
  tagFormat: "command-v${version}",
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/github",
    [
      "@semantic-release/exec",
      {
        prepareCmd:
          'sed -i -E "s/\\"[0-9]+\\.[0-9]+\\.[0-9]+\\"/\\"${nextRelease.version}\\"/g" deno.json && cat deno.json',
        publishCmd: "npx jsr publish --allow-dirty",
      },
    ],
  ],
};
