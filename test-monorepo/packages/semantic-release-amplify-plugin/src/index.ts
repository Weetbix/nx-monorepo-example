import type { Context, Release } from 'semantic-release';
import { execSync } from 'child_process';
// import * as AWS from 'aws-sdk';
// Using local mock for AWS SDK instead of the real one
import AWS from './aws-sdk-mock';

// Define project interface based on the workflow definition
interface AmplifyProject {
  name: string;
  id: string;
}

// The config that can be passed to the plugin
interface PluginConfig {
  amplifyProjects: AmplifyProject[];
}

// Interface for deploy result
interface DeployResult {
  projectId: string;
  projectName: string;
  jobId?: string;
  url?: string;
  status: 'success' | 'failure';
}

interface ExtendedContext extends Context {
  releases: Release[];
}

/**
 * Get current commit message
 */
async function getCommitTitle(): Promise<string> {
  return execSync('git log -1 --pretty=%B', { encoding: 'utf8' }).trim();
}

/**
 * Get current commit ID
 */
async function getCommitId(): Promise<string> {
  return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
}

/**
 * Deploy a project to Amplify
 */
async function deployToAmplify(
  projectId: string,
  projectName: string,
  logger: Context['logger']
): Promise<DeployResult> {
  logger.log(`Deploying ${projectName} (${projectId}) to Amplify`);

  // Initialize AWS SDK
  const amplify = new AWS.Amplify();

  try {
    // Start a deployment job
    const commitTitle = await getCommitTitle();
    const commitId = await getCommitId();

    const startJobResponse = await amplify
      .startJob({
        appId: projectId,
        branchName: 'main',
        jobType: 'RELEASE',
        jobReason: commitTitle,
        commitId,
      })
      .promise();

    const jobId = startJobResponse.jobSummary?.jobId;

    if (!jobId) {
      throw new Error('Failed to get job ID from Amplify');
    }

    logger.log(`Amplify job started with ID: ${jobId}`);

    // Monitor job status
    let jobStatus = 'PENDING';
    let jobDetails;

    while (
      jobStatus !== 'SUCCEED' &&
      jobStatus !== 'FAILED' &&
      jobStatus !== 'CANCELLED'
    ) {
      // Wait for 15 seconds between checks
      await new Promise((resolve) => setTimeout(resolve, 15000));

      const jobResponse = await amplify
        .getJob({
          appId: projectId,
          branchName: 'main',
          jobId,
        })
        .promise();

      jobDetails = jobResponse.job;
      jobStatus = jobDetails?.summary?.status || 'UNKNOWN';
      logger.log(`Current status for ${projectName}: ${jobStatus}`);
    }

    if (jobStatus === 'SUCCEED') {
      logger.log(`Deployment successful for ${projectName}`);
      return {
        projectId,
        projectName,
        jobId,
        status: 'success',
        url: `https://main.${projectId}.amplifyapp.com`,
      };
    } else {
      logger.error(`Deployment failed for ${projectName}`);
      return {
        projectId,
        projectName,
        jobId,
        status: 'failure',
      };
    }
  } catch (error) {
    logger.error(`Error deploying to Amplify: ${error}`);
    return {
      projectId,
      projectName,
      status: 'failure',
    };
  }
}

/**
 * Analyze the commit and determine if a release is needed
 * For this plugin, we'll release if Amplify config files have changed
 */
async function analyzeCommits(
  _pluginConfig: PluginConfig,
  { logger }: ExtendedContext
) {
  logger.log('Checking for Amplify configuration changes');

  // TODO is this correct? We should probably use semantic release properties
  const lastTag = execSync('git describe --tags --abbrev=0', {
    encoding: 'utf8',
  }).trim();

  // Check if amplify.yml or customHttp.yml have changed since last tag
  try {
    const diffOutput = execSync(
      `git diff ${lastTag} HEAD -- amplify.yml customHttp.yml`,
      { encoding: 'utf8' }
    ).trim();

    const hasChanges = diffOutput.length > 0;
    logger.log(`Amplify config changes detected: ${hasChanges}`);
    return 'patch';
  } catch (error) {
    logger.error(`Error checking Amplify config changes: ${error}`);
    return null;
  }
}

/**
 * Deploy the current project to Amplify
 */
async function publish(
  pluginConfig: PluginConfig,
  { logger }: ExtendedContext
) {
  // Deploy each project
  const deployResults = await Promise.all(
    pluginConfig.amplifyProjects.map(async (project) => {
      return deployToAmplify(project.id, project.name, logger);
    })
  );

  logger.log('Deployment results:');
  deployResults.forEach((result) => {
    logger.log(`${result.projectName}: ${result.status}`);
    if (result.url) {
      logger.log(`URL: ${result.url}`);
    }
  });

  if (deployResults.some((result) => result.status === 'failure')) {
    throw new Error('Deployment failed');
  }

  return deployResults.map((result) => ({
    name: `Amplify (${result.projectName})`,
    url: result.url,
  }));
}

const amplifyPlugin = {
  analyzeCommits,
  publish,
};

export = amplifyPlugin;
