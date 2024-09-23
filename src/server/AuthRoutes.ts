import express from "express";

import { hpcConfigMap } from "../../configs/config";
import * as Helper from "../helpers/Helper";
import { AllowList } from "../models/AllowList";
import { Approvals } from "../models/Approvals";
import { DenyList } from "../models/DenyList";
import dataSource from "../utils/DB";
import { modifyUserBody, ApprovalType } from "../utils/types";

import { validator } from "./ServerUtil";
import { requestErrors, schemas } from "./ServerUtil";

const authRouter = express.Router();

authRouter.post("/request/addUser", async function (req, res) {
  const errors = requestErrors(
    validator.validate(req.body, schemas.modifyUser)
  );

  if (errors.length > 0) {
    res.status(402).json({ error: "invalid input", messages: errors });
    return;
  }

  const body = req.body as modifyUserBody;

  if (!(body.hpc in hpcConfigMap)) {
    res.status(402).json({ error: "invalid hpc passed in" });
    return;
  }

  const approvalRepo = dataSource.getRepository(Approvals);

  const existing = await approvalRepo.findOneBy({
    user: body.user,
    hpc: body.hpc,
    type: ApprovalType.APPROVAL,
    approvedAt: undefined
  });

  if (existing !== null) {
    res.status(400).json({ error: "approval request already pending" });
    return;
  }

  await approvalRepo.insert({
    user: body.user,
    hpc: body.hpc,
    type: ApprovalType.APPROVAL,
    hash: Helper.randomHash(100)
  });

  res.status(200).json({ 
    messages: ["allowlist approval successfully requested"] 
  });
});

authRouter.post("/request/denyUser", async function (req, res) {
  const errors = requestErrors(
    validator.validate(req.body, schemas.modifyUser)
  );

  if (errors.length > 0) {
    res.status(402).json({ error: "invalid input", messages: errors });
    return;
  }

  const body = req.body as modifyUserBody;

  if (!(body.hpc in hpcConfigMap)) {
    res.status(402).json({ error: "invalid hpc passed in" });
    return;
  }

  const approvalRepo = dataSource.getRepository(Approvals);

  const existing = await approvalRepo.findOneBy({
    user: body.user,
    hpc: body.hpc,
    type: ApprovalType.DENIAL,
    approvedAt: undefined
  });

  if (existing !== null) {
    res.status(400).json({ error: "denial request already pending" });
    return;
  }

  await approvalRepo.insert({
    user: body.user,
    hpc: body.hpc,
    type: ApprovalType.DENIAL,
    hash: Helper.randomHash(100)
  });

  res.status(200).json({ 
    messages: ["denylist approval successfully requested"] 
  });
});

authRouter.get("/approve", async (req, res) => {
  const hash = req.query.approvalId;

  if (hash === undefined || typeof hash !== "string") {
    res.status(400).json({ error: "non-existent or invalid approval id parameter" });
    return;
  }

  const approvalRepo = dataSource.getRepository(Approvals);
  const allowRepo = dataSource.getRepository(AllowList);
  const denyRepo = dataSource.getRepository(DenyList);

  const existing = await approvalRepo.findOneBy({
    hash,
    approvedAt: undefined
  });

  if (existing === null) {
    res.status(400).json({ error: "non-existent or invalid approval id parameter" });
    return;
  }

  existing.approve();

  if (existing.type === ApprovalType.APPROVAL as string) {
    await allowRepo.insert({
      user: existing.user,
      hpc: existing.hpc
    });

    const denial = await denyRepo.findOneBy({
      user: existing.user,
      hpc: existing.hpc,
      deletedAt: undefined
    });

    if (denial !== null) {
      denial.delete();
      await denyRepo.save(denial);
    }
  } else {
    await denyRepo.insert({
      user: existing.user,
      hpc: existing.hpc
    });

    const allow = await allowRepo.findOneBy({
      user: existing.user,
      hpc: existing.hpc,
      deletedAt: undefined
    });

    if (allow !== null) {
      allow.delete();
      await allowRepo.save(allow);
    }
  }

  await approvalRepo.save(existing);

  res.status(200).json({ 
    messages: ["approval successful"] 
  });
});

export default authRouter;