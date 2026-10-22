export default {
  tagFormat: "dev-v${version}",
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/github",
    [
      "@semantic-release/exec",
      {
        prepareCmd:
          'sed -i "s/0.0.0/${nextRelease.version}/g" deno.json && cat deno.json',
        publishCmd: "npx jsr publish --allow-dirty",
      },
    ],
  ],
};
