/**
 * Image catalog routes — mounted at /api/images.
 */

import { Hono } from "hono";
import { authMiddleware } from "../../middleware";
import * as ctrl from "./images.controller";

export const imageRoutes = new Hono();

imageRoutes.use("*", authMiddleware);
imageRoutes.get("/", ctrl.list);
