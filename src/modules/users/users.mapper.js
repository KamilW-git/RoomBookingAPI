// Response DTO użytkownika: pola wymienione jawnie, więc passwordHash nie może wyciec do odpowiedzi API,
// nawet jeśli pojawi się w obiekcie z repository.
function toUserResponse(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

module.exports = { toUserResponse };
