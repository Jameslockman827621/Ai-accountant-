import { Request, Response, NextFunction } from 'express';

type AsyncRouteHandler<Req extends Request = Request, Res extends Response = Response> = (
  req: Req,
  res: Res,
  next: NextFunction
) => Promise<unknown>;

export function asyncHandler<Req extends Request = Request, Res extends Response = Response>(
  handler: AsyncRouteHandler<Req, Res>
) {
  return (req: Req, res: Res, next: NextFunction): void => {
    void handler(req, res, next).catch(next);
  };
}
