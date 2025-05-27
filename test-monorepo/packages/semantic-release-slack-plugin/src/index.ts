import { WebClient } from '@slack/web-api';
import { execSync, spawn } from 'child_process';
import type { Context, Config, Release } from 'semantic-release';
import { join } from 'path';

// Add releases item to the context, since I know it exists
interface ExtendedContext extends Context {
  releases: Release[];
}

let slackClient: WebClient;
let messageTs: string;
let channelId: string;
let monitorProcess: any;

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

  console.log('context.releases', context.releases);

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
 * Spawns a monitoring process that will update Slack if the main process dies
 */
function spawnMonitorProcess(context: ExtendedContext) {
  const { env } = context;
  const scriptPath = join(__dirname, 'monitor.js');

  // Create the complete message configuration
  const messageConfig = {
    packageName: context.options?.executorContext?.projectName || '',
    attachment: createMessageAttachment(context, 'failure'),
  };

  // Spawn the monitor process with the necessary environment variables
  monitorProcess = spawn('node', [scriptPath], {
    env: {
      ...process.env,
      SLACK_BOT_TOKEN: env.SLACK_BOT_TOKEN,
      SLACK_RELEASE_CHANNEL_ID: env.SLACK_RELEASE_CHANNEL_ID,
      SLACK_BOT_USERNAME: env.SLACK_BOT_USERNAME,
      SLACK_BOT_ICON_EMOJI: env.SLACK_BOT_ICON_EMOJI,
      MESSAGE_TS: messageTs,
      CHANNEL_ID: channelId,
      MESSAGE_CONFIG: JSON.stringify(messageConfig),
    },
    detached: true,
    stdio: 'ignore',
  });

  // Allow the parent process to exit while the monitor continues running
  monitorProcess.unref();
}

/**
 * Kills the monitoring process if it exists
 */
function killMonitorProcess() {
  if (monitorProcess) {
    monitorProcess.kill();
  }
}

/**
 * Updates the prepare function to spawn the monitor
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
    username: env.SLACK_BOT_USERNAME,
    icon_emoji: env.SLACK_BOT_ICON_EMOJI,
  });
  messageTs = response.ts as string;
  logger.log(`Posted to Slack, message timestamp: ${messageTs}`);

  // Spawn the monitor process
  spawnMonitorProcess(context);
}

/**
 * Updates the success function to kill the monitor
 */
async function success(_pluginConfig: unknown, context: ExtendedContext) {
  const { logger, env } = context;
  const messageAttachment = createMessageAttachment(context, 'success');

  logger.log('Posting release success notification to Slack...');
  await slackClient.chat.update({
    channel: channelId,
    ts: messageTs,
    attachments: [messageAttachment],
    unfurl_links: false,
    unfurl_media: false,
    username: env.SLACK_BOT_USERNAME,
    icon_emoji: env.SLACK_BOT_ICON_EMOJI,
  });
  logger.log('Successfully updated Slack message with release information');

  // Kill the monitor process
  killMonitorProcess();
}

/**
 * Updates the fail function to kill the monitor
 */
async function fail(_pluginConfig: unknown, context: ExtendedContext) {
  console.log('in fail handler (slack)');
  const { logger, env } = context;
  logger.log('in fail handler (slack)');
  const messageAttachment = createMessageAttachment(context, 'failure');

  logger.log('Posting release failure notification to Slack...');
  await slackClient.chat.update({
    channel: channelId,
    ts: messageTs,
    attachments: [messageAttachment],
    unfurl_links: false,
    unfurl_media: false,
    username: env.SLACK_BOT_USERNAME,
    icon_emoji: env.SLACK_BOT_ICON_EMOJI,
  });
  logger.log('Successfully updated Slack message with failure information');

  // Kill the monitor process
  killMonitorProcess();
}

export { prepare, success, fail };
