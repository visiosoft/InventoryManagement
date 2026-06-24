import path from 'path';
import fs from 'fs';
import puppeteer from 'puppeteer';

let sharedBrowser = null;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDelay(value, fallback, min = 0, max = 10000) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function getScrapeDelays() {
    return {
        beforeClickMs: parseDelay(process.env.WHATSAPP_ROW_BEFORE_CLICK_MS, 450, 0, 10000),
        afterClickMs: parseDelay(process.env.WHATSAPP_ROW_AFTER_CLICK_MS, 900, 0, 10000),
        betweenRowsMs: parseDelay(process.env.WHATSAPP_BETWEEN_ROWS_MS, 800, 0, 10000),
        panelSettleMs: parseDelay(process.env.WHATSAPP_CONTACT_PANEL_SETTLE_MS, 600, 0, 10000),
    };
}

function parseTimestampFromPrePlain(prePlain) {
    if (!prePlain) return null;
    const match = prePlain.match(/\[(.*?)\]/);
    if (!match) return null;
    const value = new Date(match[1]);
    return Number.isNaN(value.getTime()) ? null : value;
}

function normalizePhone(raw) {
    return String(raw || '').replace(/\D/g, '');
}

function fallbackPhoneFromTitle(title) {
    const phoneLike = String(title || '').match(/\+?[0-9][0-9\s()-]{6,}/);
    return normalizePhone(phoneLike ? phoneLike[0] : '');
}

function normalizeRowText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeLabel(value) {
    return normalizeRowText(value).toLowerCase();
}

function canonicalizeToken(value) {
    return normalizeRowText(value)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

function isLikelyUiNoiseLabel(value) {
    const text = normalizeRowText(value);
    if (!text) return true;
    if (/^\d{1,2}:\d{2}(?:\s?[AP]M)?$/i.test(text)) return true;
    if (/^(photo|video|audio|document|sticker)$/i.test(text)) return true;
    if (/https?:\/\//i.test(text)) return true;
    return false;
}

function parseAllowedLabelSet(allowedLabels) {
    if (!Array.isArray(allowedLabels)) return new Set();
    return new Set(allowedLabels.map((x) => normalizeLabel(x)).filter(Boolean));
}

function isPlaceholderChatTitle(value) {
    return /^Chat\s+\d+$/i.test(normalizeRowText(value));
}

function inferTitleFromRowSnapshot(snapshot, index) {
    const direct = normalizeRowText(snapshot?.title);
    if (direct) return direct;

    const lines = String(snapshot?.rowText || '')
        .split(/\r?\n/)
        .map((line) => normalizeRowText(line))
        .filter(Boolean)
        .filter((line) => !/^\d+ unread messages?$/i.test(line))
        .filter((line) => line.toLowerCase() !== 'loading...');

    if (lines.length > 0) {
        return lines[0];
    }

    return `Chat ${index + 1}`;
}

function shouldSkipGroupConversation(rowSnapshot, conversation) {
    const skipGroups = String(process.env.WHATSAPP_SKIP_GROUP_CHATS || 'true').toLowerCase() !== 'false';
    if (!skipGroups) return false;

    const subtitle = normalizeRowText(conversation?.headerSubtitle);
    const title = normalizeRowText(conversation?.chatTitle || rowSnapshot?.title);

    const subtitleLooksGroup =
        /\b(participants?|members?)\b/i.test(subtitle) ||
        /\d+\s+participants?/i.test(subtitle) ||
        /\d+\s+members?/i.test(subtitle);

    const titleLooksGroup = /\bgroup\b/i.test(title);
    return Boolean(rowSnapshot?.isGroup || conversation?.isGroup || subtitleLooksGroup || titleLooksGroup);
}

function debugConversationExtraction(index, rowSnapshot, conversation, mergedTitle, phone, mergedMessages) {
    console.log(
        `[WhatsAppLead][Extract] row=${index + 1} rowTitle="${String(rowSnapshot?.title || '').replace(/"/g, '')}" headerTitle="${String(conversation?.chatTitle || '').replace(/"/g, '')}" inferredTitle="${String(mergedTitle || '').replace(/"/g, '')}" phone="${phone || ''}" preview="${String(rowSnapshot?.preview || '').replace(/"/g, '')}" messages=${mergedMessages.length}`
    );
}

function extractBestPhoneCandidate(...values) {
    for (const value of values) {
        const normalized = normalizePhone(value);
        if (normalized.length >= 7) {
            return normalized;
        }
    }
    return '';
}

async function getSharedBrowser({ headless, profileDir }) {
    if (sharedBrowser?.connected) {
        return sharedBrowser;
    }

    const resolvedProfile = path.resolve(process.cwd(), profileDir);
    fs.mkdirSync(resolvedProfile, { recursive: true });

    sharedBrowser = await puppeteer.launch({
        headless,
        userDataDir: resolvedProfile,
        defaultViewport: { width: 1366, height: 900 },
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    sharedBrowser.on('disconnected', () => {
        sharedBrowser = null;
    });

    return sharedBrowser;
}

async function prepareWhatsAppPage(browser, webUrl) {
    const pages = await browser.pages();
    const existingWhatsAppPages = pages.filter((page) => {
        const url = page.url();
        return url.startsWith(webUrl) || url.includes('web.whatsapp.com');
    });

    for (const existingPage of existingWhatsAppPages) {
        if (!existingPage.isClosed()) {
            await existingPage.close();
        }
    }

    const page = await browser.newPage();
    await page.goto(webUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    return page;
}

function readHeaderTitleInPage() {
    const headerTitleEl =
        document.querySelector('header span[title][dir="auto"]') ||
        document.querySelector('header [title]') ||
        document.querySelector('header span[dir="auto"]') ||
        document.querySelector('main header');

    return String(
        headerTitleEl?.getAttribute?.('title') || headerTitleEl?.textContent || ''
    ).replace(/\s+/g, ' ').trim();
}

async function waitForOpenedChat(page, expectedTitle, rowIndex) {
    const normalizedExpected = normalizeRowText(expectedTitle);
    try {
        if (!normalizedExpected) {
            await page.waitForSelector('header', { timeout: 6000 });
            return {
                matched: true,
                headerTitle: await page.evaluate(() => readHeaderTitleInPage()),
            };
        }

        await page.waitForFunction(
            (title, targetRowIndex) => {
                const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
                const isPlaceholder = (value) => /^Chat\s+\d+$/i.test(normalizeText(value));
                const headerTitleEl =
                    document.querySelector('header span[title][dir="auto"]') ||
                    document.querySelector('header [title]') ||
                    document.querySelector('header span[dir="auto"]') ||
                    document.querySelector('main header');

                const current = normalizeText(
                    headerTitleEl?.getAttribute?.('title') || headerTitleEl?.textContent || ''
                );

                const activeRow = document.querySelector(
                    `[data-testid="list-item-${targetRowIndex}"][aria-selected="true"], ` +
                    `[data-testid="list-item-${targetRowIndex}"] [aria-selected="true"]`
                );

                if (activeRow && current && !isPlaceholder(current)) {
                    return true;
                }

                return Boolean(current) && !isPlaceholder(current)
                    && current.toLowerCase().includes(String(title).toLowerCase());
            },
            { timeout: 6000 },
            normalizedExpected,
            rowIndex
        );

        return {
            matched: true,
            headerTitle: await page.evaluate(() => readHeaderTitleInPage()),
        };
    } catch (error) {
        const headerTitle = await page.evaluate(() => readHeaderTitleInPage()).catch(() => '');
        console.warn(
            `[WhatsAppLead] Chat open confirmation timed out for row ${rowIndex + 1} expected="${normalizedExpected}" header="${headerTitle}"`
        );
        return {
            matched: false,
            headerTitle,
            error: error?.message || 'Unknown waitForOpenedChat error',
        };
    }
}

async function extractPhoneFromContactPanel(page, delays) {
    const closePanels = async () => {
        await page.keyboard.press('Escape').catch(() => {});
        await sleep(120);
        await page.keyboard.press('Escape').catch(() => {});
    };

    try {
        await page.evaluate(() => {
            const headerTarget =
                document.querySelector('header span[title][dir="auto"]') ||
                document.querySelector('header [title]') ||
                document.querySelector('header');
            headerTarget?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            headerTarget?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            headerTarget?.click();
        });

        await sleep(delays.panelSettleMs);

        await page.waitForFunction(
            () => {
                const aside = document.querySelector('[role="button"][aria-label*="Search" i]')?.closest('div[tabindex="-1"]') || document.querySelector('[data-testid="drawer-right"]') || document.querySelector('[role="complementary"]');
                return Boolean(aside || document.body.innerText.includes('Media, links and docs'));
            },
            { timeout: 5000 }
        );

        const openedSecondPanel = await page.evaluate(() => {
            const titleTarget =
                document.querySelector('[data-testid="conversation-info-header-chat-title"]') ||
                document.querySelector('span[data-testid="conversation-info-header-chat-title"]');
            if (!titleTarget) return false;

            titleTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            titleTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            titleTarget.click();
            return true;
        });

        if (openedSecondPanel) {
            await sleep(Math.max(delays.panelSettleMs, 700));
            await page.waitForFunction(
                () => {
                    const phoneLike = /\+?\d[\d\s()-]{8,}\d/;
                    const drawers = Array.from(
                        document.querySelectorAll('[data-testid="drawer-right"], [role="complementary"]')
                    );
                    const latestDrawer = drawers[drawers.length - 1];
                    const drawerText = latestDrawer?.innerText || '';
                    return phoneLike.test(drawerText);
                },
                { timeout: 5000 }
            ).catch(() => {});
        }

        const panelData = await page.evaluate(() => {
            const normalizeDigits = (value) => String(value || '').replace(/\D/g, '');
            const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

            const drawers = Array.from(
                document.querySelectorAll('[data-testid="drawer-right"], [role="complementary"]')
            );
            const latestDrawer = drawers[drawers.length - 1];
            const priorDrawer = drawers.length > 1 ? drawers[drawers.length - 2] : null;

            const aboutPhoneSection = (latestDrawer || priorDrawer || document).querySelector(
                '[data-testid="section-about-and-phone-number"]'
            );

            const explicitPhoneSelector =
                'span.x140p0ai.x1gufx9m.x1s928wv.xhkezso.x1gmr53x.x1cpjm7i.x1fgarty.x1943h6x.x193iq5w.xeuugli.x13faqbe.x1vvkbs.x1lliihq.x1fj9vlw.x1hx0egp.x1jchvi3.xjb2p0i.xo1l8bm.x17mssa0.x1ic7a3i, ' +
                'span.x140p0ai.x1gufx9m.x1s928wv.xhkezso.x1gmr53x.x1cpjm7i.x1fgarty.x1943h6x.x193iq5w.xeuugli.x13faqbe.x1vvkbs.x1lliihq.x1fj9vlw.x14ug900.x1hx0egp.x1jchvi3.xjb2p0i.xo1l8bm.x17mssa0.x1ic7a3i';

            const roots = [aboutPhoneSection, latestDrawer, priorDrawer, document].filter(Boolean);
            let phone = '';
            for (const root of roots) {
                const nodes = Array.from(root.querySelectorAll(explicitPhoneSelector));
                for (const node of nodes) {
                    const text = normalizeText(node.textContent || '');
                    if (!/^\+\d[\d\s()-]{7,}\d$/.test(text)) continue;
                    const digits = normalizeDigits(text);
                    if (digits.length >= 10 && digits.length <= 15) {
                        phone = digits;
                        break;
                    }
                }
                if (phone) break;
            }

            const labelRoots = [latestDrawer, priorDrawer, aboutPhoneSection].filter(Boolean);
            const labels = [];
            for (const root of labelRoots) {
                const isChipLabelSpan = (spanNode) => {
                    let cursor = spanNode;
                    for (let depth = 0; depth < 5 && cursor; depth += 1) {
                        if (cursor.querySelector?.('[data-testid="list-icon"]')) {
                            return true;
                        }
                        cursor = cursor.parentElement;
                    }
                    return false;
                };

                const selectorLabels = Array.from(root.querySelectorAll('span[dir="auto"].xnpuxes'))
                    .filter((node) => isChipLabelSpan(node))
                    .map((node) => normalizeText(node.textContent || ''))
                    .filter(Boolean)
                    .filter((value) => !/^\+\d[\d\s()-]{7,}\d$/.test(value))
                    .filter((value) => value.length <= 40);

                labels.push(...selectorLabels);

                if (labels.length > 0) break;
            }

            return {
                phone,
                labels: Array.from(new Set(labels)).slice(0, 8),
            };
        });

        await closePanels();
        return panelData;
    } catch {
        await closePanels();
        return { phone: '', labels: [] };
    }
}

export async function closeWhatsAppScraperBrowser() {
    if (sharedBrowser?.connected) {
        await sharedBrowser.close();
    }
    sharedBrowser = null;
}

export async function scrapeWhatsAppConversations({
    webUrl,
    headless,
    maxChats,
    messagesPerChat,
    profileDir,
    allowedLabels,
    syncOnlyAllowedLabels,
}) {
    const browser = await getSharedBrowser({ headless, profileDir });
    const delays = getScrapeDelays();
    const allowedLabelSet = parseAllowedLabelSet(allowedLabels);
    const onlyAllowed = String(syncOnlyAllowedLabels ?? 'false').toLowerCase() === 'true';

    try {
        const page = await prepareWhatsAppPage(browser, webUrl);
        await page.waitForSelector('#pane-side', { timeout: 180000 });
        await page.waitForSelector('div[data-testid="chat-list"]', { timeout: 180000 });

        const conversations = [];

        for (let index = 0; index < maxChats; index += 1) {
            const rowSnapshot = await page.evaluate((rowIndex) => {
                const row = document.querySelector(`[data-testid="list-item-${rowIndex}"]`);
                if (!row) return null;

                const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

                const titleEl =
                    row.querySelector('[data-testid="cell-frame-title"] span[title]') ||
                    row.querySelector('[data-testid="cell-frame-title"] [title]') ||
                    row.querySelector('span[title][dir="auto"]') ||
                    row.querySelector('[data-testid="cell-frame-title"]');
                const title = titleEl?.getAttribute?.('title') || titleEl?.textContent || '';

                const previewEl =
                    row.querySelector('[data-testid="last-msg-status"]') ||
                    row.querySelector('[data-testid="cell-frame-secondary"]');
                const preview = previewEl?.getAttribute?.('title') || previewEl?.textContent || '';

                const timeEl =
                    row.querySelector('[data-testid="cell-frame-primary-detail"]') ||
                    row.querySelector('[data-testid="cell-frame-secondary"]');
                const timeText = timeEl?.textContent || '';

                const rowText = row.textContent || '';
                const isGroup = Boolean(
                    row.querySelector('[data-icon="default-group"]') ||
                    row.querySelector('[data-testid="default-group"]') ||
                    row.querySelector('[aria-label*="group" i]')
                );

                const rowLabels = Array.from(row.querySelectorAll('span[dir="auto"].xnpuxes'))
                    .filter((node) => {
                        let cursor = node;
                        for (let depth = 0; depth < 5 && cursor; depth += 1) {
                            if (cursor.querySelector?.('[data-testid="list-icon"]')) {
                                return true;
                            }
                            cursor = cursor.parentElement;
                        }
                        return false;
                    })
                    .map((node) => normalizeText(node.textContent || ''))
                    .filter(Boolean)
                    .filter((value) => !/^\+\d[\d\s()-]{7,}\d$/.test(value))
                    .filter((value) => value.length <= 40)
                    .slice(0, 8);

                return {
                    title,
                    preview,
                    timeText,
                    rowText,
                    isGroup,
                    labels: rowLabels,
                };
            }, index);

            if (!rowSnapshot) break;

            if (onlyAllowed && allowedLabelSet.size > 0) {
                const rowLabelValues = (rowSnapshot.labels || []).map((value) => normalizeRowText(value)).filter(Boolean);
                const rowLabelSet = new Set(rowLabelValues.map((value) => normalizeLabel(value)).filter(Boolean));
                const hasAllowedLabel = Array.from(rowLabelSet).some((label) => allowedLabelSet.has(label));

                // Conservative pre-check: skip only when labels are detected and none are allowed.
                // If labels are missing at row level, continue and let full extraction/persistence apply strict filtering.
                if (rowLabelSet.size > 0 && !hasAllowedLabel) {
                    console.log(
                        `[WhatsAppLead][Skip] row=${index + 1} title="${normalizeRowText(rowSnapshot.title)}" labels="${rowLabelValues.join('|')}" reason="label-precheck"`
                    );
                    await sleep(delays.betweenRowsMs);
                    continue;
                }
            }

            let opened = false;

            for (let attempt = 0; attempt < 8; attempt += 1) {
                await sleep(delays.beforeClickMs);

                const didOpen = await page.evaluate((rowIndex) => {
                    const row = document.querySelector(`[data-testid="list-item-${rowIndex}"]`);
                    if (row) {
                        row.scrollIntoView({ block: 'center', inline: 'nearest' });
                        const target =
                            row.querySelector('[data-testid="cell-frame-title"] span[title]') ||
                            row.querySelector('[data-testid="cell-frame-title"]') ||
                            row.querySelector('[data-testid="cell-frame-container"]') ||
                            row.querySelector('[role="gridcell"]') ||
                            row;
                        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                        target.click();
                        return true;
                    }

                    const sidePane = document.querySelector('#pane-side');
                    if (sidePane) {
                        sidePane.scrollTop += 720;
                        return false;
                    }

                    const chatList = document.querySelector('div[data-testid="chat-list"]');
                    if (chatList?.parentElement) {
                        chatList.parentElement.scrollTop += 720;
                    }
                    return false;
                }, index);

                if (didOpen) {
                    opened = true;
                    break;
                }

                await sleep(Math.max(450, Math.floor(delays.beforeClickMs / 2)));
            }

            if (!opened) break;
            const openResult = await waitForOpenedChat(
                page,
                rowSnapshot.title || rowSnapshot.rowText || `Chat ${index + 1}`,
                index
            );
            await sleep(delays.afterClickMs);

            const conversation = await page.evaluate(async (chatIndex, perChat) => {
                const headerTitleEl =
                    document.querySelector('header span[title][dir="auto"]') ||
                    document.querySelector('header [title]') ||
                    document.querySelector('header span[dir="auto"]') ||
                    document.querySelector('main header');

                const currentTitle =
                    headerTitleEl?.getAttribute?.('title') ||
                    headerTitleEl?.textContent ||
                    `Chat ${chatIndex + 1}`;

                const headerSubtitleEl =
                    document.querySelector('header [data-testid="chat-subtitle"]') ||
                    document.querySelector('header div[title]') ||
                    document.querySelector('header');
                const headerSubtitle =
                    headerSubtitleEl?.getAttribute?.('title') ||
                    headerSubtitleEl?.textContent ||
                    '';

                const labels = [];

                const nodes = Array.from(document.querySelectorAll('div[data-testid="msg-container"]')).slice(-perChat);

                for (const node of nodes) {
                    const expandButton =
                        node.querySelector('[data-testid="caption-read-more-button"]') ||
                        node.querySelector('.read-more-button');
                    if (expandButton) {
                        expandButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                        expandButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                        expandButton.click();
                    }
                }

                if (nodes.length > 0) {
                    await new Promise((resolve) => setTimeout(resolve, 120));
                }

                const messages = nodes.map((node, msgIndex) => {
                    const selectableParts = Array.from(node.querySelectorAll('[data-testid="selectable-text"] span, span.selectable-text span'))
                        .map((chunk) => (chunk.textContent || '').replace(/\u200e|\u200f/g, ''))
                        .filter((part) => part.trim().length > 0);

                    const anchorLinks = Array.from(node.querySelectorAll('a[href]')).map((anchor) => {
                        const href = anchor.getAttribute('href') || '';
                        const title = anchor.getAttribute('title') || '';
                        const textValue = (anchor.textContent || '').trim();
                        return {
                            href,
                            title,
                            text: textValue,
                        };
                    });

                    const linkPreviewTitle =
                        node.querySelector('[data-testid="link-preview-title"]')?.textContent || '';
                    const linkDescription =
                        node.querySelector('[data-testid="link-description"]')?.textContent || '';

                    const text = [
                        selectableParts.join(' ').trim(),
                        linkPreviewTitle.trim(),
                        linkDescription.trim(),
                        anchorLinks.map((item) => item.href || item.title || item.text).filter(Boolean).join(' '),
                    ]
                        .filter(Boolean)
                        .join(' ')
                        .replace(/\s+/g, ' ')
                        .trim();

                    const copyable = node.querySelector('div.copyable-text');
                    const prePlain = copyable?.getAttribute('data-pre-plain-text') || '';
                    const convRow = node.closest('[data-testid^="conv-msg-"]');
                    const messageId =
                        convRow?.getAttribute('data-id') ||
                        copyable?.getAttribute('data-id') ||
                        `${chatIndex}-${msgIndex}-${prePlain}`;

                    const classBlob = [
                        node.className,
                        node.parentElement?.className,
                        node.querySelector('[class*="message-"]')?.className,
                    ]
                        .filter(Boolean)
                        .join(' ');

                    const direction = classBlob.includes('message-out') ? 'outbound' : 'inbound';

                    const hasImage = Boolean(
                        node.querySelector('img[src]') ||
                        node.querySelector('[data-testid*="image" i]')
                    );
                    const hasVideo = Boolean(
                        node.querySelector('video') ||
                        node.querySelector('[data-testid*="video" i]') ||
                        node.querySelector('[data-icon*="video"]')
                    );
                    const hasAudio = Boolean(
                        node.querySelector('audio') ||
                        node.querySelector('[data-testid*="audio" i]') ||
                        node.querySelector('[data-icon*="audio"]')
                    );
                    const hasDocument = Boolean(
                        node.querySelector('[data-testid*="document" i]') ||
                        node.querySelector('[data-icon*="document"]') ||
                        /\.pdf(\?|$)/i.test(text)
                    );
                    const hasLink = anchorLinks.length > 0 || Boolean(node.querySelector('[data-testid="link-preview-container"]'));

                    let messageType = 'text';
                    if (hasVideo) messageType = 'video';
                    else if (hasImage) messageType = 'image';
                    else if (hasAudio) messageType = 'audio';
                    else if (hasDocument) messageType = 'document';
                    else if (hasLink) messageType = 'link';

                    const media = {
                        hasImage,
                        hasVideo,
                        hasAudio,
                        hasDocument,
                        hasLink,
                    };

                    return {
                        messageId,
                        text,
                        prePlain,
                        direction,
                        type: messageType,
                        links: anchorLinks,
                        media,
                        raw: {
                            linkPreviewTitle: linkPreviewTitle.trim(),
                            linkDescription: linkDescription.trim(),
                        },
                    };
                });

                return {
                    chatTitle: currentTitle,
                    headerSubtitle,
                    labels,
                    isGroup: /\b(participants?|members?)\b/i.test(String(headerSubtitle || '')),
                    messages,
                };
            }, index, messagesPerChat);

            if (shouldSkipGroupConversation(rowSnapshot, conversation)) {
                console.log(
                    `[WhatsAppLead][Skip] row=${index + 1} title="${normalizeRowText(rowSnapshot.title || conversation.chatTitle)}" reason="group-chat"`
                );
                await sleep(delays.betweenRowsMs);
                continue;
            }

            const panelData = await extractPhoneFromContactPanel(page, delays);
            const phoneFromPanel = panelData?.phone || '';
            const normalizedTitle = inferTitleFromRowSnapshot(rowSnapshot, index);
            const normalizedPreview = normalizeRowText(rowSnapshot.preview);
            const normalizedHeaderTitle = normalizeRowText(
                openResult?.headerTitle || conversation.chatTitle
            );
            const phone = extractBestPhoneCandidate(phoneFromPanel);
            const nameCandidates = new Set([
                normalizeRowText(rowSnapshot?.title),
                normalizeRowText(rowSnapshot?.rowText),
                normalizeRowText(conversation?.chatTitle),
                normalizeRowText(conversation?.headerSubtitle),
                normalizeRowText(normalizedTitle),
            ].filter(Boolean));

            const mergedLabels = Array.from(
                new Set([
                    ...((rowSnapshot?.labels || []).map((v) => normalizeRowText(v)).filter(Boolean)),
                    ...(conversation.labels || []),
                    ...((panelData?.labels || []).map((v) => normalizeRowText(v)).filter(Boolean)),
                ])
            )
                .filter((label) => !isLikelyUiNoiseLabel(label))
                .filter((label) => !nameCandidates.has(normalizeRowText(label)))
                .filter((label) => {
                    const canonicalLabel = canonicalizeToken(label);
                    if (!canonicalLabel) return false;
                    for (const candidate of nameCandidates) {
                        if (canonicalizeToken(candidate) === canonicalLabel) {
                            return false;
                        }
                    }
                    return true;
                })
                .slice(0, 8);
            const mergedTitle =
                normalizedTitle ||
                (!isPlaceholderChatTitle(normalizedHeaderTitle) ? normalizedHeaderTitle : '') ||
                normalizeRowText(conversation.headerSubtitle) ||
                `Chat ${index + 1}`;
            const mergedMessages = conversation.messages.length > 0
                ? conversation.messages
                : (normalizedPreview
                    ? [{
                        messageId: `preview-${index}-${normalizedTitle || 'chat'}`,
                        text: normalizedPreview,
                        prePlain: '',
                        direction: 'inbound',
                        occurredAt: null,
                    }]
                    : []);

            conversations.push({
                phone,
                chatTitle: mergedTitle,
                rowTitle: normalizedTitle,
                rowPreview: normalizedPreview,
                rowTimeText: normalizeRowText(rowSnapshot.timeText),
                labels: mergedLabels,
                messages: mergedMessages.map((m) => ({
                    ...m,
                    occurredAt: m.occurredAt || parseTimestampFromPrePlain(m.prePlain),
                })),
            });

            debugConversationExtraction(index, rowSnapshot, conversation, mergedTitle, phone, mergedMessages);
            await sleep(delays.betweenRowsMs);
        }

        return conversations;
    } finally {
        const pages = await browser.pages();
        for (const page of pages) {
            const url = page.url();
            if (url.startsWith(webUrl) || url.includes('web.whatsapp.com')) {
                await page.close();
            }
        }
    }
}
