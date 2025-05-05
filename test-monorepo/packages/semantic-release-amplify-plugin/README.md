# Semantic Release Amplify Plugin

A semantic-release plugin for deploying Rebilly's frontend projects to AWS Amplify.

## Features

- Deploys the current NX project to AWS Amplify
- Verifies if global Amplify configuration files have changed (amplify.yml, customHttp.yml)
- Returns deployment results for use by other plugins (like the Slack notification plugin)
- Automatically detects current project from NX environment

## Installation

This plugin is installed as part of the monorepo. To build it:

```bash
cd frontend
yarn nx build semantic-release-amplify-plugin
```

## Usage

Configure this plugin in your project's semantic-release configuration:

```js
// nxrelease.config.js
module.exports = {
  // ... other config
  plugins: [
    // ... other plugins
    [
      '@rebilly/semantic-release-amplify-plugin',
      {
        amplifyProjects: [
          {
            name: 'Revel', // Should match NX project name
            id: 'd37ruqflbniuj3'
          },
          // ... other Amplify projects
        ]
      }
    ],
    '@rebilly/semantic-release-slack-plugin'
  ]
};
```

Note: The `name` property of each Amplify project should match the corresponding NX project name. The plugin uses the `NX_TASK_TARGET_PROJECT` environment variable (set by NX during task execution) to identify the current project.

## Environment Variables

The plugin requires the following environment variables:

- `AWS_ACCESS_KEY_ID`: AWS access key with permissions to deploy to Amplify
- `AWS_SECRET_ACCESS_KEY`: AWS secret key with permissions to deploy to Amplify

NX automatically provides this environment variable:

- `NX_TASK_TARGET_PROJECT`: The current project being executed (automatically set by NX)

## Plugin Behavior

1. **Verify Conditions**: Checks that AWS credentials are available and that Amplify projects are configured
2. **Analyze Commits**: Determines if a release is needed by checking:
   - If there are semantic commits that trigger a release
   - If Amplify configuration files have changed
3. **Publish**: Deploys the current project to Amplify and returns the deployment result 