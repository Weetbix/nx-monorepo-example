module.exports = {
  changelog: true,
  npm: true,
  github: false,
  repositoryUrl: 'https://github.com/Weetbix/nx-monorepo-example',
  branches: ['main'],
  commitMessage: 'chore(${PROJECT_NAME}): release version ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
  releaseRules: [
    {breaking: true, release: 'major'},
    {revert: true, release: 'patch'},
    {type: 'custom', release: 'minor'},
    {type: 'feat', release: 'minor'},
    {type: 'fix', release: 'patch'},
    {type: 'perf', release: 'patch'},
  ]
};
