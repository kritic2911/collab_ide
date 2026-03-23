import { Octokit } from '@octokit/rest';

export function makeOctokit(token: string) {
  return new Octokit({ auth: token });
}

export async function listUserRepos(token: string) {
  const octokit = makeOctokit(token);
  const { data } = await octokit.repos.listForAuthenticatedUser({ per_page: 100 });
  return data.map(r => ({ owner: r.owner.login, repo: r.name, private: r.private }));
}

export async function verifyRepoAccess(token: string, owner: string, repo: string) {
  const octokit = makeOctokit(token);
  // throws 404 if no access
  await octokit.repos.get({ owner, repo });
}

export async function getBranches(token: string, owner: string, repo: string) {
  const octokit = makeOctokit(token);
  const { data } = await octokit.repos.listBranches({ owner, repo, per_page: 100 });
  return data.map(b => b.name);
}

export async function getFileTree(token: string, owner: string, repo: string, branch: string) {
  const octokit = makeOctokit(token);
  const { data } = await octokit.git.getTree({
    owner, repo,
    tree_sha: branch,
    recursive: '1',
  });
  return data.tree; // { path, type ('blob'|'tree'), sha }[]
}

export async function getFileContent(token: string, owner: string, repo: string, path: string, ref: string) {
  const octokit = makeOctokit(token);
  const { data } = await octokit.repos.getContent({ owner, repo, path, ref }) as any;
  // data.content is base64
  return Buffer.from(data.content, 'base64').toString('utf8');
}