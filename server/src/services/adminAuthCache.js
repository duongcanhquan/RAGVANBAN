/**
 * Cache ngắn phiên quản trị — tránh getUser + loadAdmin + listCategories mỗi click.
 */

const { createTtlMap } = require('./ttlMap');

const authByToken = createTtlMap({ ttlMs: 20_000, max: 80 });

function getCachedAdmin(token) {
  if (!token) return undefined;
  return authByToken.get(token);
}

function setCachedAdmin(token, payload) {
  if (!token || !payload) return;
  authByToken.set(token, payload);
}

function invalidateAdminAuth(userId) {
  if (!userId) {
    authByToken.clear();
    return;
  }
  authByToken.invalidateWhere(
    (v) => v?.admin?.id === userId || v?.user?.id === userId
  );
}

function resetAdminAuthCache() {
  authByToken.clear();
}

module.exports = {
  getCachedAdmin,
  setCachedAdmin,
  invalidateAdminAuth,
  resetAdminAuthCache,
};
