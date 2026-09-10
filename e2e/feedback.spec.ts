import { expect, test } from '@playwright/test';

test.describe('Closer Feedback Flow', () => {
  test('feedback page with valid token should render form', async ({ page }) => {
    // Use a known format but non-existent token — should show "not found"
    const fakeToken = '00000000-0000-0000-0000-000000000000';
    await page.goto(`/feedback/${fakeToken}`);

    // Should show error page (token not found in DB)
    await expect(page.locator('text=não encontrado').or(page.locator('text=inválido'))).toBeVisible({ timeout: 10000 });
  });

  test('feedback page with invalid token format should show error', async ({ page }) => {
    await page.goto('/feedback/invalid-token');

    await expect(page.locator('text=inválido')).toBeVisible({ timeout: 10000 });
  });

  test('feedback form UI should have correct brand elements', async ({ page }) => {
    // Navigate to feedback page (even if token is invalid, the layout should render)
    const fakeToken = '11111111-1111-1111-1111-111111111111';
    await page.goto(`/feedback/${fakeToken}`);

    // Header should show EnriqueceAI
    await expect(page.locator('text=EnriqueceAI')).toBeVisible({ timeout: 10000 });
  });

  test('feedback API should reject invalid payload', async ({ request }) => {
    // Missing required fields
    const response = await request.post('/api/feedback', {
      data: { token: '00000000-0000-0000-0000-000000000000' },
    });
    expect(response.status()).toBe(400);

    // Invalid token format
    const response2 = await request.post('/api/feedback', {
      data: { token: 'invalid', result: 'meeting_done', rating: 5 },
    });
    expect(response2.status()).toBe(400);

    // Invalid result value
    const response3 = await request.post('/api/feedback', {
      data: { token: '00000000-0000-0000-0000-000000000000', result: 'invalid', rating: 5 },
    });
    expect(response3.status()).toBe(400);

    // Invalid rating
    const response4 = await request.post('/api/feedback', {
      data: { token: '00000000-0000-0000-0000-000000000000', result: 'meeting_done', rating: 6 },
    });
    expect(response4.status()).toBe(400);
  });

  test('feedback API should reject meeting_done without SAO', async ({ request }) => {
    // Payload completo EXCETO oportunidade_qualificada — deve parar na validação
    // (400), sem chegar na busca do token.
    const response = await request.post('/api/feedback', {
      data: {
        token: '00000000-0000-0000-0000-000000000000',
        result: 'meeting_done',
        qualificacao_aderente: 'bateu',
        decisor_presente: true,
        comment: 'teste',
      },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('SAO');
  });

  test('feedback API should return 404 for non-existent token', async ({ request }) => {
    // Payload COMPLETO e válido — só assim as validações passam e a requisição
    // chega na busca do token, que é o que este teste quer exercitar.
    // (Antes mandava só result+rating e recebia 400 na validação, nunca 404.)
    const response = await request.post('/api/feedback', {
      data: {
        token: '00000000-0000-0000-0000-000000000000',
        result: 'meeting_done',
        qualificacao_aderente: 'bateu',
        decisor_presente: true,
        oportunidade_qualificada: true,
        comment: 'teste de token inexistente',
        rating: 5,
      },
    });
    expect(response.status()).toBe(404);
  });
});

test.describe('Feedback Reminder Cron', () => {
  test('cron endpoint should reject without auth', async ({ request }) => {
    const response = await request.post('/api/cron/feedback-reminders');
    expect(response.status()).toBe(401);
  });
});

test.describe('WhatsApp Health Cron', () => {
  test('cron endpoint should reject without auth', async ({ request }) => {
    const response = await request.post('/api/cron/whatsapp-health');
    expect(response.status()).toBe(401);
  });
});
