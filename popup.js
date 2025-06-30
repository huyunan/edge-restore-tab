document.addEventListener('DOMContentLoaded', function() {
    let closedTabs = [];

    function formatTimeDifference(closedAt) {
        const now = Date.now();
        const diffInSeconds = Math.floor((now - closedAt) / 1000);

        if (diffInSeconds < 60) {
            return '刚刚关闭';
        } else if (diffInSeconds < 3600) {
            const minutes = Math.floor(diffInSeconds / 60);
            return `${minutes} 分钟前关闭`;
        } else if (diffInSeconds < 86400) {
            const hours = Math.floor(diffInSeconds / 3600);
            return `${hours} 小时前关闭`;
        } else {
            const days = Math.floor(diffInSeconds / 86400);
            return `${days} 天前关闭`;
        }
    }

    function displayTabs(tabs) {
        const tabList = document.getElementById('tabList');
        tabList.innerHTML = '';
        
        if (tabs.length === 0) {
            const noTabsElement = document.createElement('div');
            noTabsElement.textContent = '没有关闭的标签页记录';
            noTabsElement.classList.add('no-tabs');
            tabList.appendChild(noTabsElement);
            return;
        }

        tabs.forEach(tab => {
            const tabElement = document.createElement('div');
            tabElement.classList.add('tab-item');

            // 创建左侧内容区域
            const contentDiv = document.createElement('div');
            contentDiv.classList.add('tab-content');

            // 添加网站图标
            const faviconElement = document.createElement('img');
            faviconElement.classList.add('tab-favicon');
            
            // 直接使用标签页保存的 favIconUrl
            faviconElement.src = tab.favIconUrl || chrome.runtime.getURL('default-favicon.png');
            
            // 如果图标加载失败，使用默认图标
            faviconElement.onerror = () => {
                faviconElement.src = chrome.runtime.getURL('default-favicon.png');
            };

            // 添加标题和时间
            const textDiv = document.createElement('div');
            textDiv.classList.add('tab-text');

            const titleElement = document.createElement('div');
            titleElement.classList.add('tab-title');
            titleElement.textContent = tab.title || '无标题';

            const timeElement = document.createElement('div');
            timeElement.classList.add('tab-time');
            timeElement.textContent = formatTimeDifference(tab.closedAt);

            // 组装内容区域
            textDiv.appendChild(titleElement);
            textDiv.appendChild(timeElement);
            contentDiv.appendChild(faviconElement);
            contentDiv.appendChild(textDiv);

            // 创建删除按钮
            const deleteButton = document.createElement('button');
            deleteButton.classList.add('delete-button');
            deleteButton.innerHTML = '×';
            deleteButton.title = '删除';  // 添加本地化的提示文字

            // 添加删除功能
            deleteButton.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    closedTabs = closedTabs.filter(t => t.closedAt !== tab.closedAt);
                    await chrome.storage.local.set({ closedTabs });
                    tabElement.remove();
                    const searchInput = document.getElementById('searchInput');
                    const searchTerm = searchInput.value.toLowerCase().trim();
                    let filteredTabs = []
                    if (searchTerm) {
                        filteredTabs = closedTabs.filter(tab => 
                            (tab.title && tab.title.toLowerCase().includes(searchTerm)) ||
                            (tab.url && tab.url.toLowerCase().includes(searchTerm))
                        );
                    } else {
                        filteredTabs = closedTabs
                    }
                    if (filteredTabs.length == 0) {
                        const noTabsElement = document.createElement('div');
                        noTabsElement.textContent = '没有检索的标签页记录';
                        noTabsElement.classList.add('no-tabs');
                        tabList.appendChild(noTabsElement);
                    }
                } catch (error) {
                    console.error('删除标签页时出错:', error);
                }
            });

            // 添加点击事件（打开标签页）
            tabElement.addEventListener('click', () => {
                if (tab.url) {
                    chrome.tabs.create({ url: tab.url });
                }
            });

            // 组装最终的列表项
            tabElement.appendChild(contentDiv);
            tabElement.appendChild(deleteButton);
            tabList.appendChild(tabElement);
        });
    }

    function toggleClass(flag) {
        const switchDiv = document.getElementById('switchDiv').classList
        const switchBtn = document.getElementById('switchBtn').classList
        if (flag === null) {
            switchDiv.toggle('is-checked')
            switchBtn.toggle('is-active')
        } else {
            switchDiv.toggle('is-checked', flag)
            switchBtn.toggle('is-active', flag)
        }
    }

    document.getElementById('searchInput').addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const filteredTabs = closedTabs.filter(tab => 
            (tab.title && tab.title.toLowerCase().includes(searchTerm)) ||
            (tab.url && tab.url.toLowerCase().includes(searchTerm))
        );
        displayTabs(filteredTabs);
    });

    document.getElementById('switchDiv').addEventListener('click', () => {
        toggleClass()
        const switchDiv = document.getElementById('switchDiv').classList
        if (switchDiv.contains('is-checked')) {
            chrome.storage.local.set({ switchInput: true })
        } else {
            chrome.storage.local.set({ switchInput: false })
        }
    });

    chrome.storage.local.get(['switchInput'], (result) => {
        toggleClass(!!result.switchInput)
    })

    document.getElementById('clearAll').addEventListener('click', () => {
        // 直接发送清空消息，不显示确认对话框
        chrome.storage.local.set({ closedTabs: [] }, () => {
            // 清空列表显示
            displayTabs([]);
            closedTabs = []
            document.getElementById('searchInput').value = '';
        })
    });

    // 确保在初始化时也调用 displayTabs
    chrome.storage.local.get(['closedTabs'], (result) => {
        closedTabs = result.closedTabs || [];
        displayTabs(closedTabs);
    });
});
