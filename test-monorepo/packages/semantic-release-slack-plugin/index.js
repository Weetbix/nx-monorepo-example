const { WebClient } = require('@slack/web-api');

let slackClient;
let messageTs;
let channelId;

/**
 * Creates message blocks for the release start notification
 */
function createStartMessageBlocks(context) {
  const {
    nextRelease,
    branch,
    options,
    env: { SEMANTIC_RELEASE_PACKAGE, npm_package_name },
  } = context;

  const repoUrl = options.repositoryUrl || '';
  const packageName = SEMANTIC_RELEASE_PACKAGE || npm_package_name || 'package';

  // Determine release types
  let releaseTypes = context.releaseTypes || ['npm']; // Default to npm if not specified

  // Auto-detect S3 publishing if not explicitly configured
  if (!context.releaseTypesExplicit && detectS3Publishing(context)) {
    if (!releaseTypes.includes('s3')) {
      releaseTypes = [...releaseTypes, 's3'];
    }
  }

  // Format release types for display
  const releaseTypesText = releaseTypes
    .map((type) => type.toUpperCase())
    .join(' & ');

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `Release process started for ${packageName}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Branch:*\n${branch.name}`,
        },
        {
          type: 'mrkdwn',
          text: `*Status:*\n:hourglass: In Progress`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Starting ${releaseTypesText} release process for version ${
          nextRelease?.version || 'unknown'
        }`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `${repoUrl ? `<${repoUrl}|Repository>` : 'Repository'}`,
        },
      ],
    },
  ];
}

/**
 * Detect if S3 publishing is being used
 */
function detectS3Publishing(context) {
  if (!context || !context.options || !context.options.plugins) {
    return false;
  }

  const plugins = context.options.plugins;

  // Check for @semantic-release/exec with publish-to-s3.js script
  return plugins.some((plugin) => {
    if (!Array.isArray(plugin) || plugin.length < 2) {
      return false;
    }

    const [pluginName, pluginConfig] = plugin;

    if (pluginName !== '@semantic-release/exec') {
      return false;
    }

    // Check if publishCmd contains publish-to-s3.js
    return (
      pluginConfig &&
      pluginConfig.publishCmd &&
      typeof pluginConfig.publishCmd === 'string' &&
      pluginConfig.publishCmd.includes('publish-to-s3.js')
    );
  });
}

/**
 * Creates message blocks for the release success notification
 */
function createSuccessMessageBlocks(context) {
  const {
    nextRelease,
    options,
    env: { SEMANTIC_RELEASE_PACKAGE, npm_package_name },
  } = context;

  const repoUrl = options.repositoryUrl || '';
  const packageName = SEMANTIC_RELEASE_PACKAGE || npm_package_name || 'package';

  // Get release types from context
  const releaseTypes = context.releaseTypes || ['npm'];

  // Generate release links
  const releaseLinks = [];

  if (releaseTypes.includes('npm')) {
    const npmUrl = `https://www.npmjs.com/package/${packageName}/v/${nextRelease.version}`;
    releaseLinks.push(`<${npmUrl}|NPM Release>`);
  }

  if (releaseTypes.includes('s3')) {
    // Try to extract CDN URL from context, or use default format
    const cdnUrl =
      context.cdnUrl ||
      process.env.CDN_URL ||
      `https://cdn.example.com/${packageName}/${nextRelease.version}/`;

    releaseLinks.push(`<${cdnUrl}|S3 Release>`);
  }

  // Default git release link
  const gitReleaseUrl = nextRelease.gitHead
    ? `${repoUrl}/releases/tag/${nextRelease.gitHead}`
    : '';

  if (gitReleaseUrl) {
    releaseLinks.push(`<${gitReleaseUrl}|Git Release>`);
  }

  // Create a compact message for multi-package releases
  return [
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*${packageName} v${nextRelease.version}*\n:white_check_mark: Success`,
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: releaseLinks.join(' | '),
        },
      ],
    },
    nextRelease.notes
      ? {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:arrow_down: *<#|Release notes>*`,
          },
          accessory: {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View',
              emoji: true,
            },
            action_id: `view_notes_${packageName}_${nextRelease.version}`,
          },
        }
      : null,
  ].filter(Boolean);
}

/**
 * Creates message blocks for the release failure notification
 */
function createFailureMessageBlocks(context) {
  const {
    branch,
    env: { SEMANTIC_RELEASE_PACKAGE, npm_package_name },
  } = context;

  const packageName = SEMANTIC_RELEASE_PACKAGE || npm_package_name || 'package';

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `Release failed for ${packageName}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Branch:*\n${branch.name}`,
        },
        {
          type: 'mrkdwn',
          text: `*Status:*\n:x: Failed`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `The release process has failed. Please check the logs for more information.`,
      },
    },
  ];
}

/**
 * A semantic-release plugin that posts release updates to Slack
 * @param {Object} pluginConfig - The plugin configuration
 * @param {string} pluginConfig.channelId - The Slack channel ID to post to
 * @param {Array} pluginConfig.releaseTypes - The types of releases being performed ['npm', 's3']
 * @param {string} pluginConfig.cdnUrl - Custom URL for S3/CDN releases
 * @param {Object} context - The semantic-release context
 * @returns {Object} The plugin object with lifecycle methods
 */
async function prepare(pluginConfig, context) {
  const {
    logger,
    env: {
      SEMANTIC_RELEASE_PACKAGE,
      npm_package_name,
      SLACK_BOT_TOKEN,
      SLACK_RELEASE_CHANNEL_ID,
    },
  } = context;

  // Pass release types from pluginConfig to context
  if (pluginConfig.releaseTypes) {
    context.releaseTypes = pluginConfig.releaseTypes;
    context.releaseTypesExplicit = true;
  } else {
    context.releaseTypes = ['npm'];
    context.releaseTypesExplicit = false;

    // Auto-detect S3 publishing if not explicitly configured
    if (detectS3Publishing(context)) {
      context.releaseTypes.push('s3');
    }
  }

  context.cdnUrl = pluginConfig.cdnUrl;

  // Create message blocks
  const messageBlocks = createStartMessageBlocks(context);

  const slackToken = SLACK_BOT_TOKEN;
  channelId = SLACK_RELEASE_CHANNEL_ID;
  const packageName = SEMANTIC_RELEASE_PACKAGE || npm_package_name || 'package';

  if (!slackToken) {
    logger.log(
      'No Slack token found in environment variables (SLACK_BOT_TOKEN). Skipping Slack notification.'
    );
    return;
  }

  if (!channelId) {
    logger.log(
      'No Slack channel ID found in environment variables (SLACK_RELEASE_CHANNEL_ID). Skipping Slack notification.'
    );
    return;
  }

  slackClient = new WebClient(slackToken);

  logger.log('Posting release start notification to Slack...');

  try {
    const response = await slackClient.chat.postMessage({
      channel: channelId,
      blocks: messageBlocks,
      text: `Release process started for ${packageName}`,
    });

    messageTs = response.ts;
    logger.log(`Posted to Slack, message timestamp: ${messageTs}`);
  } catch (error) {
    logger.error('Error posting to Slack:', error);
  }
}

/**
 * Update the Slack message with success information
 */
async function success(pluginConfig, context) {
  const {
    logger,
    nextRelease,
    env: { SEMANTIC_RELEASE_PACKAGE, npm_package_name },
  } = context;

  // Pass release types from pluginConfig to context if not already set
  if (!context.releaseTypes) {
    if (pluginConfig.releaseTypes) {
      context.releaseTypes = pluginConfig.releaseTypes;
      context.releaseTypesExplicit = true;
    } else {
      context.releaseTypes = ['npm'];
      context.releaseTypesExplicit = false;

      // Auto-detect S3 publishing if not explicitly configured
      if (detectS3Publishing(context)) {
        context.releaseTypes.push('s3');
      }
    }
    context.cdnUrl = pluginConfig.cdnUrl;
  }

  // Create message blocks
  const messageBlocks = createSuccessMessageBlocks(context);
  const packageName = SEMANTIC_RELEASE_PACKAGE || npm_package_name || 'package';

  if (!slackClient || !messageTs) {
    logger.log(
      'Slack client not initialized or no message to update. Skipping Slack notification.'
    );
    return;
  }

  logger.log('Posting release success notification to Slack...');

  try {
    await slackClient.chat.update({
      channel: channelId,
      ts: messageTs,
      blocks: messageBlocks,
      text: `Release successful for ${packageName} v${nextRelease.version}`,
    });

    logger.log('Successfully updated Slack message with release information');
  } catch (error) {
    logger.error('Error updating Slack message:', error);
  }
}

/**
 * Update the Slack message with failure information
 */
async function fail(pluginConfig, context) {
  const {
    logger,
    env: { SEMANTIC_RELEASE_PACKAGE, npm_package_name },
  } = context;

  // Create message blocks
  const messageBlocks = createFailureMessageBlocks(context);
  const packageName = SEMANTIC_RELEASE_PACKAGE || npm_package_name || 'package';

  if (!slackClient || !messageTs) {
    logger.log(
      'Slack client not initialized or no message to update. Skipping Slack notification.'
    );
    return;
  }

  logger.log('Posting release failure notification to Slack...');

  try {
    await slackClient.chat.update({
      channel: channelId,
      ts: messageTs,
      blocks: messageBlocks,
      text: `Release failed for ${packageName}`,
    });

    logger.log('Successfully updated Slack message with failure information');
  } catch (error) {
    logger.error('Error updating Slack message:', error);
  }
}

module.exports = { prepare, success, fail };
