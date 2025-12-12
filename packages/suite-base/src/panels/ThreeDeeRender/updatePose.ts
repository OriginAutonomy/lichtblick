// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { TransformTree, makePose, Pose, AnyFrameId } from "./transforms";

const tempPose = makePose();

export function updatePose(
  renderable: THREE.Object3D,
  transformTree: TransformTree,
  renderFrameId: AnyFrameId,
  fixedFrameId: AnyFrameId,
  srcFrameId: string,
  dstTime: bigint,
  srcTime: bigint,
): boolean {
  const pose = renderable.userData.pose as Readonly<Pose> | undefined;
  if (!pose) {
    throw new Error(`Missing userData.pose for ${renderable.name}`);
  }
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/6be7cdfa-005b-444b-b26d-7cfae485f680',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'updatePose.ts:27',message:'updatePose before apply',data:{renderableName:renderable.name,srcFrameId,renderFrameId,fixedFrameId,dstTime:dstTime.toString(),srcTime:srcTime.toString(),inputPose:{x:pose.position.x,y:pose.position.y,z:pose.position.z}},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  const poseApplied = Boolean(
    transformTree.apply(tempPose, pose, renderFrameId, fixedFrameId, srcFrameId, dstTime, srcTime),
  );
  renderable.visible = poseApplied;
  if (poseApplied) {
    const p = tempPose.position;
    const q = tempPose.orientation;
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/6be7cdfa-005b-444b-b26d-7cfae485f680',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'updatePose.ts:34',message:'updatePose after apply',data:{renderableName:renderable.name,position:{x:p.x,y:p.y,z:p.z},orientation:{x:q.x,y:q.y,z:q.z,w:q.w}},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    renderable.position.set(p.x, p.y, p.z);
    renderable.quaternion.set(q.x, q.y, q.z, q.w);
  } else {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/6be7cdfa-005b-444b-b26d-7cfae485f680',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'updatePose.ts:37',message:'updatePose failed',data:{renderableName:renderable.name,srcFrameId,renderFrameId,fixedFrameId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
  }
  return poseApplied;
}
