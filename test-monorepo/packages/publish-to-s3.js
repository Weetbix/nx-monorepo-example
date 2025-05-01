// Dummy script with these inputs:
// version
// sourceFilePath
// targetFolderName
// process.env.CDN_S3_BUCKET
// process.env.CDN_CLOUDFRONT_DIST_ID
const version = process.argv[2];
const sourceFilePath = process.argv[3];
const targetFileName = process.argv[4];
const targetFolderName = process.argv[5];

// For example:
// execSync(`aws s3 cp --acl public-read ${sourceFilePath} s3://${process.env.CDN_S3_BUCKET}/${targetFolderName}/@${version}/${targetFileName}`, {stdio: 'inherit'})

console.log('Dummy publish to S3 with these inputs:', {
  version,
  sourceFilePath,
  targetFileName,
  targetFolderName,
});
