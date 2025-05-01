const { WebClient } = require('@slack/web-api');

let slackClient;
let messageTs;
let channelId;

/**
 * Creates a consistent message block format for all states
 * @param {Object} context - The semantic-release context
 * @param {String} status - Current status: 'pending', 'success', or 'failure'
 * @param {String} version - The version being released
 */
function createMessageBlocks(context, status, version) {
  const {
    branch,
    options,
  } = context;

  const packageName = options.executorContext?.projectName;
  const repoUrl = options.repositoryUrl || '';
  const releaseTypes = context.releaseTypes || ['npm'];
  
  // Format release types for display
  const releaseTypesText = releaseTypes
    .map((type) => type.toUpperCase())
    .join(' & ');

  // Status-specific values
  let statusEmoji, statusText;
  switch (status) {
    case 'pending':
      statusEmoji = ':hourglass:';
      statusText = 'In Progress';
      break;
    case 'success':
      statusEmoji = ':white_check_mark:';
      statusText = 'Success';
      break;
    case 'failure':
      statusEmoji = ':x:';
      statusText = 'Failed';
      break;
    default:
      statusEmoji = ':grey_question:';
      statusText = 'Unknown';
  }

  // Generate release links (only for success)
  const releaseLinks = [];
  if (status === 'success' && version) {
    if (releaseTypes.includes('npm')) {
      const npmUrl = `https://www.npmjs.com/package/${packageName}/v/${version}`;
      releaseLinks.push(`<${npmUrl}|NPM>`);
    }

    if (releaseTypes.includes('s3')) {
      const cdnUrl = context.cdnUrl || 
                    process.env.CDN_URL || 
                    `https://cdn.example.com/${packageName}/${version}/`;
      releaseLinks.push(`<${cdnUrl}|CDN>`);
    }

    if (repoUrl) {
      releaseLinks.push(`<${repoUrl}|Repo>`);
    }
  }

  return [
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*${packageName}* ${version ? `v${version}` : ''}\n${statusEmoji} ${statusText}`,
        },
        {
          type: 'mrkdwn',
          text: `*Type:*\n${releaseTypesText}\n*Branch:*\n${branch.name}`,
        },
      ],
    },
    releaseLinks.length > 0 ? {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: releaseLinks.join(' | '),
        },
      ],
    } : null,
  ].filter(Boolean);
}

/**
 * Creates message blocks for the release start notification
 */
function createStartMessageBlocks(context) {
  return createMessageBlocks(context, 'pending');
}

/**
 * Creates message blocks for the release success notification
 */
function createSuccessMessageBlocks(context) {
  const { nextRelease } = context;
  return createMessageBlocks(context, 'success', nextRelease?.version);
}

/**
 * Creates message blocks for the release failure notification
 */
function createFailureMessageBlocks(context) {
  return createMessageBlocks(context, 'failure');
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
    env,
    options,
  } = context;

  const {
    SLACK_BOT_TOKEN,
    SLACK_RELEASE_CHANNEL_ID,
  } = env;

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
  const packageName = options.executorContext?.projectName || 'package';

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
    options,
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
  const packageName = options.executorContext?.projectName || 'package';

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
    options,
  } = context;

  // Create message blocks
  const messageBlocks = createFailureMessageBlocks(context);
  const packageName = options.executorContext?.projectName || 'package';

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
