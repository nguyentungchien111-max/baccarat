import { Router, type IRouter } from "express";
import healthRouter from "./health";
import predictRouter from "./predict";

const router: IRouter = Router();

router.use(healthRouter);
router.use(predictRouter);

export default router;
