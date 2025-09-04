const axios = require('axios');
const config = require('./config.json');
const Vibrant = require('node-vibrant');
const fs = require('fs');

const STATE_FILE_PATH = './state.json';
const MAX_IDS_TO_STORE = 200; 

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const GELBOORU_API_BASE_URL = 'https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1';
const AUTH_PARAMS = `&user_id=${config.gelbooruUserId}&api_key=${config.gelbooruApiKey}`;

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE_PATH)) {
            const data = fs.readFileSync(STATE_FILE_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('[ERROR] Не удалось прочитать или обработать файл state.json:', error);
    }
    return {};
}

function saveState(state) {
    try {
        fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2));
    } catch (error) {
        console.error('[ERROR] Не удалось сохранить состояние в state.json:', error);
    }
}

async function fetchPostsFromApi(searchConfig) {
    try {
        const tags = searchConfig.tags;
        const ratings = searchConfig.ratings;
        const url = `${GELBOORU_API_BASE_URL}&tags=${encodeURIComponent(tags.concat(ratings))}&limit=6&pid=0${AUTH_PARAMS}`;
        const response = await axios.get(url);

        if (!response.data || !response.data.post || !Array.isArray(response.data.post)) {
            return [];
        }
        
       return response.data.post;

    } catch (error) {
        console.error(`[ERROR] Ошибка при получении данных с Gelbooru: ${error.message}`);
        return null;
    }
}

async function sendToDiscord(post, searchConfig) {
    if (!post) return;

    let embedColor = 0x0099ff; 
    
    try {
        const palette = await Vibrant.from(post.file_url).getPalette();
        const swatch = palette.Vibrant || palette.Muted;
        if (swatch) {
            embedColor = parseInt(swatch.hex.substring(1), 16);
        }
    } catch (err) {
    }

    let tagsString = post.tags;
    if (tagsString.length > 1024) {
        tagsString = tagsString.substring(0, 1020) + '...';
    }

    const embed = {
        title: `Новый арт по тегу: ${searchConfig.tags}`,
        url: `https://gelbooru.com/index.php?page=post&s=view&id=${post.id}`,
        color: embedColor,
        image: { url: post.file_url },
        fields: [
            { name: 'Рейтинг', value: post.rating, inline: false },
        ],
        footer: { text: 'Отправлено с Gelbooru', icon_url: 'https://media.discordapp.net/attachments/1388583647447224434/1404899966383685722/gelbooru-logo.png'},
        timestamp: new Date().toISOString(),
    };

    let finalUrl = config.discordWebhookUrl;
    if (config.threadId && config.threadId.length > 0) finalUrl += `?thread_id=${config.threadId}`;

    try {
        await axios.post(finalUrl, {
            username: 'Afrodita Art',
            avatar_url: config.avatarUrl,
            embeds: [embed],
        });
        console.log(`[INFO] Успешно отправлен новый арт (ID: ${post.id}).`);
        return true;
    } catch (error) {
        console.error('[ERROR] Ошибка при отправке в Discord:', error.message);
        return false; 
    }
}

async function performCheck() {
    console.log(`\n[INFO] Запуск проверки на наличие новых артов... (${new Date().toLocaleString('ru-RU')})`);
    
    const state = loadState();

    for (const searchConfig of config.searches) {
        const tagsKey = searchConfig.tags;
        
        if (!state[tagsKey] || !Array.isArray(state[tagsKey])) {
            state[tagsKey] = [];
        }
        const sentIds = new Set(state[tagsKey]);
        
        console.log(`--- [CHECK] Теги: "${tagsKey}". В базе ${sentIds.size} отправленных постов.`);

        const latestPosts = await fetchPostsFromApi(searchConfig);
        if (latestPosts === null) continue;
        const newPosts = latestPosts.filter(post => !sentIds.has(String(post.id)));

        if (newPosts.length > 0) {
            console.log(`[SUCCESS] Найдено ${newPosts.length} ранее не отправленных артов для "${tagsKey}"!`);
            
          
            for (const post of newPosts.reverse()) {
                const success = await sendToDiscord(post, searchConfig);
                
            
                if (success) {
                    state[tagsKey].push(String(post.id));
                }
                await wait(2000);
            }
        }
        
        if (state[tagsKey].length > MAX_IDS_TO_STORE) {
            state[tagsKey] = state[tagsKey].slice(-MAX_IDS_TO_STORE);
        }
    }

    saveState(state);
    console.log('[INFO] Проверка завершена. Состояние сохранено.');
}


async function runPollingLoop() {
    if (!config.discordWebhookUrl || config.discordWebhookUrl === "ВАШ_URL_ВЕБХУКА") {
        console.error("[FATAL] Пожалуйста, укажите ваш URL вебхука в файле config.json");
        process.exit(1);
    }
    if (!config.gelbooruApiKey || !config.gelbooruUserId) {
        console.error("[FATAL] Пожалуйста, укажите ваши API Key и User ID от Gelbooru в файле config.json");
        process.exit(1);
    }
    if (!config.searches || !Array.isArray(config.searches) || config.searches.length === 0) {
        console.error("[FATAL] Пожалуйста, настройте хотя бы один поиск в массиве 'searches' в файле config.json");
        process.exit(1);
    }

    console.log(`[INFO] Бот-трекер запущен в режиме постоянного опроса. Интервал: ${config.pollingIntervalSeconds} секунд.`);

    while (true) {
        try {
            await performCheck();
            console.log(`[INFO] Перехожу в режим ожидания на ${config.pollingIntervalSeconds} секунд...`);
            await wait(config.pollingIntervalSeconds * 1000);
        } catch (error) {
            console.error('[FATAL LOOP ERROR] В главном цикле произошла критическая ошибка:', error);
            console.log('[INFO] Попытка перезапуска через 60 секунд...');
            await wait(60000);
        }
    }
}

runPollingLoop();