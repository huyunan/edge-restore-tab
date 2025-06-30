const MAX_TABS = 300 // 最多保存300个关闭的标签页

let tabsInfo = new Map()
let closedTabs = []
let switchInput = false

function saveCurrentTab() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      chrome.storage.local.set({
        [`tab_${tab.id}`]: {
          title: tab.title,
          url: tab.url,
          favIconUrl: tab.favIconUrl
        }
      })
    })
  })
}

chrome.storage.local.get(['switchInput'], (result) => {
  switchInput = !!result.switchInput
  if (switchInput) {
    chrome.action.setPopup({popup: ''});
  } else {
    chrome.action.setPopup({popup: 'popup.html'});
  }
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    chrome.storage.local.set({
      [`tab_${tabId}`]: {
        title: tab.title,
        url: tab.url,
        favIconUrl: tab.favIconUrl
      }
    })
    console.log(`标签页更新: ${tabId}, ${tab.title}, ${tab.favIconUrl}`)
  }
})

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  try {
    const result = await chrome.storage.local.get(`tab_${tabId}`)
    const tabInfo = result[`tab_${tabId}`]

    if (!tabInfo) {
      console.log(`未找到标签页信息: ${tabId}`)
      return
    }

    if (isNewTabPage(tabInfo.url)) {
      console.log(`跳过新标签页: ${tabId}`)
      return
    }

    const closedTab = {
      id: tabId,
      url: tabInfo.url,
      title: tabInfo.title,
      favIconUrl: tabInfo.favIconUrl,
      closedAt: Date.now()
    }

    chrome.storage.local.get(['closedTabs'], (result) => {
      let closedTabs = result.closedTabs || []
      closedTabs.unshift(closedTab)
      // 限制存储数量
      if (closedTabs.length > MAX_TABS) {
        closedTabs = closedTabs.slice(0, MAX_TABS)
      }
      chrome.storage.local.set({ closedTabs })
    })
  } catch (error) {
    console.error(`Error closing tab: ${error}`)
  }
})

chrome.runtime.onInstalled.addListener(async () => {
  chrome.storage.local.set({ closedTabs: [] }, () => {
    console.log('已清空本地存储中的 closedTabs')
  })

  saveCurrentTab()
})

chrome.runtime.onStartup.addListener(() => {
  saveCurrentTab()
})

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getClosedTabs') {
    chrome.storage.local.get('closedTabs', (data) => {
      sendResponse({ closedTabs: data.closedTabs || [] })
    })
    return true // 保持消息通道开放
  } else if (request.action === 'clearAllClosedTabs') {
    chrome.storage.local.set({ closedTabs: [] }, () => {
      sendResponse({ success: true })
    })
    return true // 保持消息通道开放
  }
})
// 检查是否为新标签页
function isNewTabPage(url, pendingUrl) {
  const newTabUrls = [
    'chrome://newtab/', // Chrome
    'edge://newtab/', // Edge
    'chrome-search://local-ntp', // 某些版本的 Chrome/Edge
    'about:blank', // 空白页
    'about:newtab' // Firefox 风格
  ]

  // 如果 URL 是 undefined 或 null，返回 false
  if (!url && !pendingUrl) {
    return false
  }

  // 检查 URL 是否匹配任何新标签页 URL
  return newTabUrls.some(
    (newTabUrl) => url === newTabUrl || pendingUrl === newTabUrl
  )
}

async function getCurrentTabId() {
  let queryOptions = { active: true, lastFocusedWindow: true }
  // `tab` will either be a `tabs.Tab` instance or `undefined`.
  let [tab] = await chrome.tabs.query(queryOptions)
  return tab?.id
}

chrome.action.onClicked.addListener(() => {
  reopenLastTab()
});
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (changes['switchInput']) {
    switchInput = changes['switchInput'].newValue
    if (switchInput) {
      chrome.action.setPopup({popup: ''});
    } else {
      chrome.action.setPopup({popup: 'popup.html'});
    }
  }
});
// 修改重新打开最后标签页的函数
function reopenLastTab() {
  if (!switchInput) return
  chrome.storage.local.get(['closedTabs'], async (result) => {
    const closedTabs = result.closedTabs || []
    if (closedTabs.length > 0) {
      const lastTab = closedTabs[0] // 获取最后关闭的标签页（数组第一个元素）
      chrome.tabs.create({ url: lastTab.url }, function () {
        // 从存储中移除这个标签页
        closedTabs.shift()
        chrome.storage.local.set({ closedTabs: closedTabs })
      })
    } else {
      const tabId = await getCurrentTabId()
      if (tabId) {
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: () => alert('没有关闭的标签页记录')
        })
      }
    }
  })
}
