'use strict';

function optionalHermesMockNotice(url) {
  return `Hermes mock listening on ${url} `
    + '(optional non-claim smoke only; not required for factory-of-record claims — GitLab #272)\n';
}

module.exports = { optionalHermesMockNotice };
