const { WebClient } = require('@slack/web-api');

let slackClient;
let messageTs;
let channelId;

/**
 * Creates message blocks for the release start notification
 */
function createStartMessageBlocks(context) {
  const { nextRelease, branch } = context;
  const repoUrl = context.options.repositoryUrl || '';
  
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `Release process started for ${context.env.npm_package_name || 'package'}`,
        emoji: true
      }
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Branch:*\n${branch.name}`
        },
        {
          type: 'mrkdwn',
          text: `*Status:*\n:hourglass: In Progress`
        }
      ]
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Starting release process for version ${nextRelease?.version || 'unknown'}`
      }
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `${repoUrl ? `<${repoUrl}|Repository>` : 'Repository'}`
        }
      ]
    }
  ];
}

/**
 * Creates message blocks for the release success notification
 */
function createSuccessMessageBlocks(context) {
  const { nextRelease } = context;
  const repoUrl = context.options.repositoryUrl || '';
  const releaseUrl = nextRelease.gitHead ? 
    `${repoUrl}/releases/tag/${nextRelease.gitHead}` : '';
  
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `Release successful for ${context.env.npm_package_name || 'package'} ${nextRelease.version}`,
        emoji: true
      }
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Version:*\n${nextRelease.version}`
        },
        {
          type: 'mrkdwn',
          text: `*Status:*\n:white_check_mark: Success`
        }
      ]
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Release notes:\n${nextRelease.notes || 'No release notes available'}`
      }
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: releaseUrl ? `<${releaseUrl}|View Release>` : 'Release completed'
        }
      ]
    }
  ];
}

/**
 * Creates message blocks for the release failure notification
 */
function createFailureMessageBlocks(context) {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `Release failed for ${context.env.npm_package_name || 'package'}`,
        emoji: true
      }
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Branch:*\n${context.branch.name}`
        },
        {
          type: 'mrkdwn',
          text: `*Status:*\n:x: Failed`
        }
      ]
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `The release process has failed. Please check the logs for more information.`
      }
    }
  ];
}

/**
 * A semantic-release plugin that posts release updates to Slack
 * @param {Object} pluginConfig - The plugin configuration
 * @param {string} pluginConfig.channelId - The Slack channel ID to post to
 * @param {Object} context - The semantic-release context
 * @returns {Object} The plugin object with lifecycle methods
 */
async function prepare(pluginConfig, context) {
  const { logger } = context;
  const { slackToken, channelId: configChannelId } = pluginConfig;
  
  // Create message blocks
  const messageBlocks = createStartMessageBlocks(context);
  
  if (!slackToken) {
    throw new Error('No Slack token provided. Set the slackToken option in your plugin configuration.');
  }
  
  if (!configChannelId) {
    throw new Error('No Slack channel ID provided. Set the channelId option in your plugin configuration.');
  }
  
  channelId = configChannelId;
  slackClient = new WebClient(slackToken);
  
  logger.log('Posting release start notification to Slack...');
  
  try {
    const response = await slackClient.chat.postMessage({
      channel: channelId,
      blocks: messageBlocks
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
  const { logger } = context;
  
  // Create message blocks
  const messageBlocks = createSuccessMessageBlocks(context);
  
  if (!slackClient || !messageTs) {
    logger.error('Slack client not initialized or no message to update');
    return;
  }
  
  logger.log('Posting release success notification to Slack...');
  
  try {
    await slackClient.chat.update({
      channel: channelId,
      ts: messageTs,
      blocks: messageBlocks
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
  const { logger } = context;
  
  // Create message blocks
  const messageBlocks = createFailureMessageBlocks(context);
  
  if (!slackClient || !messageTs) {
    logger.error('Slack client not initialized or no message to update');
    return;
  }
  
  logger.log('Posting release failure notification to Slack...');
  
  try {
    await slackClient.chat.update({
      channel: channelId,
      ts: messageTs,
      blocks: messageBlocks
    });
    
    logger.log('Successfully updated Slack message with failure information');
  } catch (error) {
    logger.error('Error updating Slack message:', error);
  }
}

module.exports = { prepare, success, fail }; 