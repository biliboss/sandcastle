/**
 * `coordinator init` — resolves a GitHub Project's metadata (node id, field
 * ids, status option ids) and writes them to `.coordinator/config.json`.
 *
 * Subsequent commands (`start`, `dispatch`, `resume`) read this file instead
 * of re-querying the GraphQL API.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FetchGraphQL } from "./ProjectPoll.js";

const METADATA_QUERY = `
  query($login: String!, $number: Int!) {
    user(login: $login) {
      projectV2(number: $number) {
        id
        number
        fields(first: 50) {
          nodes {
            __typename
            ... on ProjectV2Field { id name }
            ... on ProjectV2SingleSelectField {
              id name
              options { id name }
            }
          }
        }
      }
    }
  }
`;

export interface InitCommandArgs {
  readonly cwd: string;
  readonly fetchGraphQL: FetchGraphQL;
  readonly projectNumber: number;
  readonly projectOwner: string;
  readonly pollIntervalSec?: number;
}

export const runInitCommand = async (args: InitCommandArgs): Promise<void> => {
  const data = await args.fetchGraphQL(METADATA_QUERY, {
    login: args.projectOwner,
    number: args.projectNumber,
  });
  const project = data?.user?.projectV2;
  if (!project) {
    throw new Error(
      `Project ${args.projectOwner}/#${args.projectNumber} not found (or insufficient gh auth scope).`,
    );
  }
  const fields = (project.fields?.nodes ?? []) as Array<any>;
  const statusField = fields.find(
    (f) => f.name === "Status" && f.__typename === "ProjectV2SingleSelectField",
  );
  if (!statusField) {
    throw new Error("Project is missing a Status field of single-select type.");
  }
  const repoField = fields.find((f) => f.name === "Repository");
  const statusOptionIds: Record<string, string> = {};
  for (const opt of statusField.options ?? []) {
    statusOptionIds[opt.name] = opt.id;
  }

  const config = {
    projectNumber: project.number,
    projectOwner: args.projectOwner,
    projectNodeId: project.id,
    pollIntervalSec: args.pollIntervalSec ?? 30,
    statusFieldId: statusField.id,
    repositoryFieldId: repoField?.id,
    statusOptionIds,
  };

  const dir = join(args.cwd, ".coordinator");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "config.json"),
    JSON.stringify(config, null, 2) + "\n",
    "utf8",
  );
};
