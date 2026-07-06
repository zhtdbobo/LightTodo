import { test, expect } from '@playwright/test'

test.describe('自定义分组功能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
  })

  test('应该显示未分类', async ({ page }) => {
    await expect(page.locator('text=未完成')).toBeVisible()
    await expect(page.locator('text=已完成')).toBeVisible()
  })

  test('应该能创建自定义分组', async ({ page }) => {
    // 点击添加分组按钮
    await page.locator('button:has-text("添加分组"), button:has-text("新建分组")').click()

    // 输入分组名称
    const input = page.locator('input[placeholder*="分组名称"]')
    await input.fill('工作')
    await input.press('Enter')

    // 验证分组创建成功
    await expect(page.locator('text=工作')).toBeVisible()
  })

  test('应该能重命名自定义分组', async ({ page }) => {
    // 先创建一个分组
    await page.locator('button:has-text("添加分组"), button:has-text("新建分组")').click()
    const input = page.locator('input[placeholder*="分组名称"]')
    await input.fill('工作')
    await input.press('Enter')

    // 双击分组名称进行重命名
    const groupName = page.locator('text=工作')
    await groupName.dblclick()

    // 修改名称
    const renameInput = page.locator('input[value="工作"]')
    await renameInput.fill('个人')
    await renameInput.press('Enter')

    await expect(page.locator('text=个人')).toBeVisible()
    await expect(page.locator('text=工作')).not.toBeVisible()
  })

  test('应该能删除自定义分组', async ({ page }) => {
    // 创建分组
    await page.locator('button:has-text("添加分组"), button:has-text("新建分组")').click()
    const input = page.locator('input[placeholder*="分组名称"]')
    await input.fill('临时分组')
    await input.press('Enter')

    await expect(page.locator('text=临时分组')).toBeVisible()

    // 悬停显示删除按钮
    const group = page.locator('text=临时分组').locator('..')
    await group.hover()
    await group.locator('button[aria-label*="删除"]').click()

    await expect(page.locator('text=临时分组')).not.toBeVisible()
  })

  test('不应该能删除或重命名未分类', async ({ page }) => {
    // 尝试双击未分类
    const todoGroup = page.locator('text=未完成').first()
    await todoGroup.dblclick()

    // 不应该出现输入框
    await expect(page.locator('input[value="未完成"]')).not.toBeVisible()

    // 悬停未分类
    await todoGroup.hover()

    // 不应该显示删除按钮
    const deleteButton = page.locator('text=未完成').locator('..').locator('button[aria-label*="删除"]')
    await expect(deleteButton).not.toBeVisible()
  })

  test('应该能将待办移动到不同分组', async ({ page }) => {
    // 创建自定义分组
    await page.locator('button:has-text("添加分组"), button:has-text("新建分组")').click()
    const groupInput = page.locator('input[placeholder*="分组名称"]')
    await groupInput.fill('工作')
    await groupInput.press('Enter')

    // 添加待办
    const todoInput = page.locator('input[placeholder*="添加"]')
    await todoInput.fill('需要移动的任务')
    await todoInput.press('Enter')

    // 右键或拖拽待办到工作分组
    const todo = page.locator('text=需要移动的任务')
    await todo.click({ button: 'right' })

    // 点击移动到工作分组
    await page.locator('text=移动到').click()
    await page.locator('text=工作').click()

    // 切换到工作分组查看
    await page.locator('text=工作').click()
    await expect(page.locator('text=需要移动的任务')).toBeVisible()
  })

  test('删除分组时待办应该移回未完成', async ({ page }) => {
    // 创建分组并添加待办
    await page.locator('button:has-text("添加分组"), button:has-text("新建分组")').click()
    const groupInput = page.locator('input[placeholder*="分组名称"]')
    await groupInput.fill('临时分组')
    await groupInput.press('Enter')

    await page.locator('text=临时分组').click()

    const todoInput = page.locator('input[placeholder*="添加"]')
    await todoInput.fill('分组中的任务')
    await todoInput.press('Enter')

    // 删除分组
    const group = page.locator('text=临时分组').first()
    await group.hover()
    await group.locator('..').locator('button[aria-label*="删除"]').click()

    // 切换到未完成分组
    await page.locator('text=未完成').click()

    // 验证待办已移回
    await expect(page.locator('text=分组中的任务')).toBeVisible()
  })
})
