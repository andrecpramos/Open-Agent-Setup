// Session handling: a signed cookie resolved to a user on every request.
export const SESSION_TTL_MINUTES = 30;

export function requireAuth(req, res, next) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user; // { id, orgId, role }
  return next();
}
