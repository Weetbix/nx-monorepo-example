module.exports = {
  changelog: true,
  npm: true,
  github: false,
  repositoryUrl: 'https://github.com/Weetbix/nx-monorepo-example',
  branches: ['main'],
  commitMessage:
    'chore(${PROJECT_NAME}): release version ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
  presetConfig: {
    types: [
      { type: 'custom', section: 'Features' },
      // defaults
      { type: 'feat', section: 'Features' },
      { type: 'feature', section: 'Features' },
      { type: 'fix', section: 'Bug Fixes' },
      { type: 'perf', section: 'Performance Improvements' },
      { type: 'revert', section: 'Reverts' },
      { type: 'docs', section: 'Documentation', hidden: true },
      { type: 'style', section: 'Styles', hidden: true },
      { type: 'chore', section: 'Miscellaneous Chores', hidden: true },
      { type: 'refactor', section: 'Code Refactoring', hidden: true },
      { type: 'test', section: 'Tests', hidden: true },
      { type: 'build', section: 'Build System', hidden: true },
      { type: 'ci', section: 'Continuous Integration', hidden: true },
    ],
  },
  releaseRules: [
    { breaking: true, release: 'major' },
    { revert: true, release: 'patch' },
    { type: 'custom', release: 'minor' },
    { type: 'feat', release: 'minor' },
    { type: 'fix', release: 'patch' },
    { type: 'perf', release: 'patch' },
  ],
};
