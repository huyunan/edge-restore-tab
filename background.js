const MAX_TABS = 300 // 最多保存300个关闭的标签页
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
  setPopup(switchInput)
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
      return
    }

    const closedTab = {
      id: tabId,
      url: tabInfo.url,
      title: tabInfo.title,
      favIconUrl: tabInfo.favIconUrl,
      closedAt: Date.now()
    }
    // 使用完后删除缓存
    chrome.storage.local.remove(`tab_${tabId}`)
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
  const sessions = await chrome.sessions.getRecentlyClosed({maxResults: 10})
  const closeds = []
  sessions.forEach(session => {
    // 不同窗口的最近关闭标签
    if(session.window?.tabs) {
      session.window.tabs.forEach(tab => {
        const closedTab = {
          id: session.window.sessionId,
          url: tab.url,
          title: tab.title,
          favIconUrl: tab.favIconUrl,
          closedAt: Number(session.lastModified + '000')
        }
        closeds.push(closedTab)
      })
    } else {
      const closedTab = {
        id: session.tab.sessionId,
        url: session.tab.url,
        title: session.tab.title,
        favIconUrl: session.tab.favIconUrl,
        closedAt: Number(session.lastModified + '000')
      }
      closeds.push(closedTab)
    }
  });
  chrome.storage.local.set({ closedTabs: closeds }, () => {
    console.log('已清空本地存储中的 closedTabs')
  })
  saveCurrentTab()
})
chrome.runtime.onStartup.addListener(() => {
  saveCurrentTab()
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
  let [tab] = await chrome.tabs.query(queryOptions)
  return tab?.id
}

chrome.action.onClicked.addListener(() => {
  if (!switchInput) return
  reopenLastTab()
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (changes['switchInput']) {
    switchInput = changes['switchInput'].newValue
    setPopup(switchInput)
  }
});

chrome.contextMenus.onClicked.addListener(
  () => {
    switchInput = !switchInput
    chrome.storage.local.set({ switchInput })
  }
)

// popup 以及右键菜单设置
async function setPopup(switchInput) {
  if (switchInput) {
    chrome.action.setPopup({popup: ''});
  } else {
    chrome.action.setPopup({popup: 'popup.html'});
  }
  try {
    await chrome.contextMenus.update('弹出框', {
      title: `弹出框${switchInput ? '显示' : '隐藏'}`,
      contexts: ['action'],
    });
  } catch (error) {
    if (error.toString().indexOf('弹出框') > -1) {
      chrome.contextMenus.create({
        id: '弹出框',
        title: `弹出框${switchInput ? '显示' : '隐藏'}`,
        contexts: ['action'],
      });
    } else {
      console.log('error', error)
    }
  }
}

// 添加快捷键监听
chrome.commands.onCommand.addListener(function(command) {
    if (command === "restore-tab") {
      reopenLastTab();
    }
});

// 修改重新打开最后标签页的函数
function reopenLastTab() {
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
