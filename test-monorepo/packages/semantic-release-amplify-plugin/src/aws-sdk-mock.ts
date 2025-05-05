// Mock implementation of AWS SDK for testing purposes

export class Amplify {
  startJob(params: {
    appId: string;
    branchName: string;
    jobType: string;
    jobReason: string;
    commitId: string;
  }): { promise: () => Promise<{ jobSummary?: { jobId: string } }> } {
    console.log('MOCK: Amplify.startJob called with params:', params);
    
    return {
      promise: () => Promise.resolve({
        jobSummary: {
          jobId: `mock-job-${Date.now()}`
        }
      })
    };
  }

  getJob(params: {
    appId: string;
    branchName: string;
    jobId: string;
  }): { promise: () => Promise<{ job?: { summary?: { status: string } } }> } {
    console.log('MOCK: Amplify.getJob called with params:', params);
    
    return {
      promise: () => Promise.resolve({
        job: {
          summary: {
            status: 'SUCCEED' // Always succeed in mock
          }
        }
      })
    };
  }
}

// Export the namespace as default export
export default {
  Amplify
}; 