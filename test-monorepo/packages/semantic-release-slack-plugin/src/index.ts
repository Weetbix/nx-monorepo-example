import { WebClient } from '@slack/web-api';
import { execSync } from 'child_process';
import type { Context, Config, Release } from 'semantic-release';

// Add releases item to the context, since I know it exists
interface ExtendedContext extends Context {
  releases: Release[];
}

let slackClient: WebClient;
let messageTs: string;
let channelId: string;

/**
 * Extracts PR number from commit message
 */
function extractPrNumber(message: string) {
  const match = message.match(/\(#(\d+)\)$/);
  return match?.[1] || null;
}

function getCurrentCommitMessage() {
  return execSync('git log -1 --pretty=%B').toString().trim();
}

/**
 * Creates a consistent message attachment format for all states
 * @param context The semantic-release context
 * @param status Current status: 'pending', 'success', or 'failure'
 */
function createMessageAttachment(
  context: ExtendedContext,
  status: 'pending' | 'success' | 'failure'
) {
  const { options, env, nextRelease } = context;

  const version = nextRelease?.version || '';
  const packageName = options?.executorContext?.projectName || '';

  // Status configurations
  const statusConfigs: Record<
    'pending' | 'success' | 'failure',
    {
      emoji: string;
      text: string;
      color: string;
      message: string;
    }
  > = {
    pending: {
      emoji: ':hourglass:',
      text: 'In Progress',
      color: '#3AA3E3', // Blue
      message: `Releasing *${packageName}* \`v${version}\``,
    },
    success: {
      emoji: ':white_check_mark:',
      text: 'Success',
      color: '#36a64f', // Green
      message: `Released *${packageName}* \`v${version}\``,
    },
    failure: {
      emoji: ':x:',
      text: 'Failed',
      color: '#E01E5A', // Red
      message: `Release failed for *${packageName}*`,
    },
  };

  const statusConfig = statusConfigs[status];
  const workflowUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const commitTitle = getCurrentCommitMessage();
  const prNumber = extractPrNumber(commitTitle);
  const prLink = `https://github.com/${env.GITHUB_REPOSITORY}/pull/${prNumber}`;

  let links: {
    text: string;
    url: string;
  }[] = [
    {
      text: 'workflow',
      url: workflowUrl,
    },
  ];

  // Generate release links (only for success)
  if (status === 'success' && context.releases) {
    links = [
      ...context.releases
        // Make NPM releases the first ones
        .reverse()
        .filter((release: Release) => release.url && release.name)
        .map((release: Release) => {
          return {
            url: release.url!,
            // shorten npm release names
            text: release?.name?.includes('npm') ? 'npm' : release.name!,
          };
        }),
      ...links,
    ];
  }

  // Create the main attachment with colored sidebar
  const attachment = {
    color: statusConfig.color,
    fallback: `${packageName} v${version} - ${statusConfig.text}`,
    blocks: [
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `${statusConfig.emoji} ${statusConfig.message}`,
          },
          {
            type: 'mrkdwn',
            text: `🔗 ${links
              .map((link) => `<${link.url}|${link.text}>`)
              .join(' | ')}`,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*PR:* <${prLink}|${commitTitle}>`,
        },
      },
    ],
  };

  return attachment;
}

/**
 * Sends a release start notification to Slack
 */
async function prepare(_pluginConfig: unknown, context: ExtendedContext) {
  const { logger, env } = context;
  const messageAttachment = createMessageAttachment(context, 'pending');

  slackClient = new WebClient(env.SLACK_BOT_TOKEN);
  channelId = env.SLACK_RELEASE_CHANNEL_ID;

  logger.log('Posting release start notification to Slack...');
  const response = await slackClient.chat.postMessage({
    channel: channelId,
    attachments: [messageAttachment],
    unfurl_links: false,
    unfurl_media: false,
    username: 'new guy',
    icon_emoji: 'rocket',
  });
  messageTs = response.ts as string;
  logger.log(`Posted to Slack, message timestamp: ${messageTs}`);
}

/**
 * Update the Slack message with success information
 */
async function success(_pluginConfig: unknown, context: ExtendedContext) {
  const { logger } = context;
  const messageAttachment = createMessageAttachment(context, 'success');

  logger.log('Posting release success notification to Slack...');
  await slackClient.chat.update({
    channel: channelId,
    ts: messageTs,
    attachments: [messageAttachment],
    unfurl_links: false,
    unfurl_media: false,
  });
  logger.log('Successfully updated Slack message with release information');
}

/**
 * Update the Slack message with failure information
 */
async function fail(_pluginConfig: unknown, context: ExtendedContext) {
  const { logger } = context;
  const messageAttachment = createMessageAttachment(context, 'failure');

  logger.log('Posting release failure notification to Slack...');
  await slackClient.chat.update({
    channel: channelId,
    ts: messageTs,
    attachments: [messageAttachment],
    unfurl_links: false,
    unfurl_media: false,
  });
  logger.log('Successfully updated Slack message with failure information');
}

export { prepare, success, fail };
