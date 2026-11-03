import { z } from "zod";
export const PROTOCOL_VERSION = 1;
const id = z.string().uuid();
const nickname = z.string().trim().min(1).max(40);
export const clientMessage = z.object({
  v: z.literal(1), messageId: id,
  payload: z.discriminatedUnion("type", [
    z.object({ type: z.literal("room.create"), nickname }).strict(),
    z.object({ type: z.literal("room.join"), roomId: id, token: z.string().regex(/^[a-f0-9]{32}$/), nickname }).strict(),
    z.object({ type: z.literal("room.admit"), peerId: id, allow: z.boolean() }).strict(),
    z.object({ type: z.literal("room.leave") }).strict(),
    z.object({ type: z.literal("share.request") }).strict(),
    z.object({ type: z.literal("share.stopped"), version: z.number().int().nonnegative() }).strict(),
    z.object({ type: z.literal("ping") }).strict(),
    z.object({ type: z.literal("rtc.description"), targetPeerId: id, generation: z.number().int().min(0).max(1000000), description: z.object({ type: z.enum(["offer", "answer"]), sdp: z.string().min(1).max(48000) }).strict() }).strict(),
    z.object({ type: z.literal("rtc.candidate"), targetPeerId: id, generation: z.number().int().min(0).max(1000000), candidate: z.object({ candidate: z.string().max(4096), sdpMid: z.string().max(256).nullable(), sdpMLineIndex: z.number().int().min(0).max(255).nullable() }).strict().nullable() }).strict(),
  ]),
}).strict();
export type ClientMessage = z.infer<typeof clientMessage>;
