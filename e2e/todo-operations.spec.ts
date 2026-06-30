import { test, expect } from '@playwright/test'

test.describe('待办操作', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
  })

  test('应该能添加新待办', async ({ page }) => {
    const input = page.locator('input[placeholder*="添加"]')
    await input.fill('测试待办项')
    await input.press('Enter')

    await expect(page.locator('text=测试待办项')).toBeVisible()
  })

  test('应该能标记待办为完成', async ({ page }) => {
    // 先添加一个待办
    const input = page.locator('input[placeholder*="添加"]')
    await input.fill('待完成的任务')
    await input.press('Enter')

    // 点击复选框标记完成
    const checkbox = page.locator('input[type="checkbox"]').first()
    await checkbox.check()

    // 验证待办被标记为完成（通常会有删除线样式）
    const todoText = page.locator('text=待完成的任务')
    await expect(todoText).toHaveCSS('text-decoration', /line-through/)
  })

  test('应该能删除待办', async ({ page }) => {
    // 添加待办
    const input = page.locator('input[placeholder*="添加"]')
    await input.fill('要删除的任务')
    await input.press('Enter')

    await expect(page.locator('text=要删除的任务')).toBeVisible()

    // 悬停显示删除按钮并点击
    const todoItem = page.locator('text=要删除的任务').locator('..')
    await todoItem.hover()
    await todoItem.locator('button[aria-label*="删除"], button:has-text("删除")').click()

    await expect(page.locator('text=要删除的任务')).not.toBeVisible()
  })

  test('应该能编辑待办内容', async ({ page }) => {
    // 添加待办
    const input = page.locator('input[placeholder*="添加"]')
    await input.fill('原始内容')
    await input.press('Enter')

    // 双击或点击编辑按钮
    const todoText = page.locator('text=原始内容')
    await todoText.dblclick()

    // 修改内容
    const editInput = page.locator('input[value="原始内容"]')
    await editInput.fill('修改后的内容')
    await editInput.press('Enter')

    await expect(page.locator('text=修改后的内容')).toBeVisible()
    await expect(page.locator('text=原始内容')).not.toBeVisible()
  })

  test('应该能清空所有已完成的待办', async ({ page }) => {
    // 添加多个待办
    const input = page.locator('input[placeholder*="添加"]')

    await input.fill('任务1')
    await input.press('Enter')

    await input.fill('任务2')
    await input.press('Enter')

    await input.fill('任务3')
    await input.press('Enter')

    // 标记前两个为完成
    const checkboxes = page.locator('input[type="checkbox"]')
    await checkboxes.nth(0).check()
    await checkboxes.nth(1).check()

    // 点击清空已完成按钮
    await page.locator('button:has-text("清空已完成"), button:has-text("清除")').click()

    // 验证只剩下未完成的任务
    await expect(page.locator('text=任务1')).not.toBeVisible()
    await expect(page.locator('text=任务2')).not.toBeVisible()
    await expect(page.locator('text=任务3')).toBeVisible()
  })
})
