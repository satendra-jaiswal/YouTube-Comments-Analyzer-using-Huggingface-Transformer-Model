// popup.js - handles interaction with the extension's popup, sends requests to the
// service worker (background.js), and updates the popup's UI (popup.html) on completion.
import {
    Chart,
    BarController,
    BarElement,
    CategoryScale,
    LinearScale,
    Tooltip,
    Legend,
} from 'chart.js';

// Register required components
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);


const analyzeBtn = document.getElementById('analyze');
const outputElement = document.getElementById('output');

document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKeyInput');
    const saveApiKeyButton = document.getElementById('saveApiKey');
    const mainContent = document.getElementById('mainContent');
    const apiKeySection = document.getElementById('apiKeySection');

    // Check if API key is already saved
    chrome.storage.sync.get(['YCM_API_KEY'], (result) => {
        if (result.YCM_API_KEY) {
            apiKeySection.style.display = 'none';
            mainContent.style.display = 'block';
        }
    });

    // Save the API key
    saveApiKeyButton.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        if (apiKey) {
            chrome.storage.sync.set({ YCM_API_KEY: apiKey }, () => {
                alert('API Key saved successfully!');
                apiKeySection.style.display = 'none';
                mainContent.style.display = 'block';
            });
        } else {
            alert('Please enter a valid API key.');
        }
    });
});

const clearApiKeyButton = document.getElementById('clearApiKey');

clearApiKeyButton.addEventListener('click', () => {
    chrome.storage.sync.remove(['YCM_API_KEY'], () => {
        alert('API Key cleared!');
        mainContent.style.display = 'none';
        apiKeySection.style.display = 'block';
    });
});

// Listen for changes made to the textbox.
analyzeBtn.addEventListener('click', async () => {
    outputElement.innerHTML = '<img id="spinner" src="icons/1494.gif" alt="Loading..." />';
    await new Promise(r => setTimeout(r, 2000));
    try {
        const videoId = await getVideoIdFromActiveTab();
        if (!videoId) {
            outputElement.innerHTML = "No YouTube video detected.";
            return;
        }


        const comments = await fetchComments(videoId);

        // outputElement.innerHTML = JSON.stringify(comments, null, 2);

        // const comments = get_dummy_data().items.map(item => item.snippet.topLevelComment.snippet.textDisplay);
        const sentiments = await analyzeSentiments(comments);

        // Aggregate sentiment counts
        const sentimentCounts = sentiments.reduce(
            (acc, { sentiment }) => {
                acc[sentiment] = (acc[sentiment] || 0) + 1;
                return acc;
            },
            { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0 }
        );



        // Create the chart
        const ctx = document.getElementById("sentimentChart").getContext("2d");
        prepare_chart(ctx, sentimentCounts);

        outputElement.innerHTML = "";

    } catch (error) {
        outputElement.innerHTML = error;
    }
});

async function prepare_chart(ctx, sentimentCounts) {

    new Chart(ctx, {
        type: "bar",
        data: {
            labels: ["Positive", "Neutral", "Negative"],
            datasets: [
                {
                    label: "Sentiment",
                    data: [
                        sentimentCounts.POSITIVE,
                        sentimentCounts.NEUTRAL,
                        sentimentCounts.NEGATIVE,
                    ],
                    backgroundColor: ["#4caf50", "#ffeb3b", "#f44336"],
                },
            ],
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: false,
                    position: "top", // Position can be 'top', 'bottom', 'left', 'right'
                },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.dataset.label}: ${context.raw}`,
                    },
                },
            },
        },
    });
    // new Chart(ctx, {
    //     type: "bar",
    //     data: {
    //         labels: ["Sentiments"], // Use a single label for all sentiments
    //         datasets: [
    //             {
    //                 label: "Positive",
    //                 data: [sentimentCounts.POSITIVE],
    //                 backgroundColor: "#4caf50",
    //             },
    //             {
    //                 label: "Neutral",
    //                 data: [sentimentCounts.NEUTRAL],
    //                 backgroundColor: "#ffeb3b",
    //             },
    //             {
    //                 label: "Negative",
    //                 data: [sentimentCounts.NEGATIVE],
    //                 backgroundColor: "#f44336",
    //             },
    //         ],
    //     },
    //     options: {
    //         responsive: true,
    //         plugins: {
    //             legend: {
    //                 display: true,
    //                 position: "top", // Position can be 'top', 'bottom', 'left', 'right'
    //             },
    //             tooltip: {
    //                 callbacks: {
    //                     label: (context) => `${context.dataset.label}: ${context.raw}`,
    //                 },
    //             },
    //         },
    //         scales: {
    //             x: {
    //                 stacked: true,
    //             },
    //             y: {
    //                 beginAtZero: true,
    //                 stacked: true,
    //             },
    //         },
    //     },
    // });

}


async function getVideoIdFromActiveTab() {

    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) {
                reject("No active tab found.");
                return;
            }

            const url = tabs[0].url;
            const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
            if (!url) {
                reject("Could not find the youtube video url");
                return;
            }
            const match = url.match(regex);
            resolve(match ? match[1] : null);
        });
    });
}

async function fetchComments(videoId) {

    const apiKey = await getApiKey();

    const response = await fetch(
        `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&key=${apiKey}&maxResults=300`
    );
    const data = await response.json();
    return fetchAllTextDisplay(data);

}

function getApiKey() {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.get(['YCM_API_KEY'], (result) => {
            if (result && result.YCM_API_KEY) {
                resolve(result.YCM_API_KEY); // Resolve with the YCM_API_KEY
            } else {
                reject('YCM_API_KEY not found');
            }
        });
    });
}

async function fetchAllTextDisplay(data) {
    const texts = [];

    // Helper function to process each snippet
    function processSnippet(snippet) {
        if (!snippet) return;

        // Add the textDisplay if it exists
        if (snippet.textDisplay) {
            texts.push(snippet.textDisplay);
        }

        // Check for replies and process recursively
        if (snippet.replies && snippet.replies.comments) {
            snippet.replies.comments.forEach(reply => {
                processSnippet(reply.snippet);
            });
        }
    }

    // Iterate through all top-level comments
    if (data.items) {
        data.items.forEach(item => {
            if (item.snippet && item.snippet.topLevelComment) {
                processSnippet(item.snippet.topLevelComment.snippet);
            }
        });
    }

    return texts;
}

async function analyzeSentiments(comments) {

    // return comments.map(comment => ({ comment, sentiment: getSentimentPrediction(comment) }));

    const sentimentPromises = comments.map((comment) => {
        return new Promise((resolve, reject) => {
            const message = {
                action: 'classify',
                text: comment,
            };

            chrome.runtime.sendMessage(message, (response) => {
                // console.log("Response from background:", response);
                if (chrome.runtime.lastError) {
                    console.error("Error:", chrome.runtime.lastError.message);
                    reject(chrome.runtime.lastError);
                } else if (response && response[0].label) {
                    resolve({ comment, sentiment: response[0].label });
                } else {
                    reject("Invalid response from background.");
                }
            });
        });
    });

    return Promise.all(sentimentPromises);
}

async function getSentimentPrediction(comment) {
    const message = {
        action: 'classify',
        text: comment,
    }
    // Send this message to the service worker.
    chrome.runtime.sendMessage(message, (response) => {
        // Handle results returned by the service worker (`background.js`) and update the popup's UI.
        return response;
    });
}

function get_dummy_data() {
    const data = {
        "kind": "youtube#commentThreadListResponse",
        "etag": "Pvp9b2Qe7FcZoj3b0vDwD8zWfQc",
        "nextPageToken": "Z2V0X25ld2VzdF9maXJzdC0tQ2dnSWdBUVZGN2ZST0JJRkNJY2dHQUFTQlFpb0lCZ0FFZ1VJaVNBWUFCSUZDSWdnR0FBU0JRaWRJQmdCSWc0S0RBamt3THU3QmhDNG5PVzhBUQ==",
        "pageInfo": {
            "totalResults": 100,
            "resultsPerPage": 100
        },
        "items": [
            {
                "kind": "youtube#commentThread",
                "etag": "LHCzLJZHf97KSuioMRtlGXrfzZQ",
                "id": "UgzkrU2sA82DFLCbBfx4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "4fNgouewI6wVsiF40XKlPi_23Dk",
                        "id": "UgzkrU2sA82DFLCbBfx4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "My suggestion to the younger gen: One&#39; life baby spend and enjoy now because you won&#39;t get this golden time at your 50&#39;s..",
                            "textOriginal": "My suggestion to the younger gen: One' life baby spend and enjoy now because you won't get this golden time at your 50's..",
                            "authorDisplayName": "@HEY-DJ",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/QFYHJ0-ipAgyY3-vPcWQR3XFqTdDZxYEoMouiOhGUXC0mIR0kahR2hRM3QGEhz_avFVaORBOLA=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@HEY-DJ",
                            "authorChannelId": {
                                "value": "UC7_PzcZZLrRqKvZoP-ZtwcA"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 1,
                            "publishedAt": "2024-12-29T17:51:32Z",
                            "updatedAt": "2024-12-29T17:51:32Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "r2_5hMIbJWc2X5HAXwdaENkacCY",
                "id": "UgyQXTEfyNMaY_uK65x4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "V5KSglm8c7N39J1AsoRyZjMxrg4",
                        "id": "UgyQXTEfyNMaY_uK65x4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "This is a lie and scripted.",
                            "textOriginal": "This is a lie and scripted.",
                            "authorDisplayName": "@Sabir-x6n",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/SNbsL7UedU9LWtNM24t-mVd7dakUcss5GlZB96xCuf4x-D7g97azK_ZQhHpPIxOPiNwxBQ8g=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@Sabir-x6n",
                            "authorChannelId": {
                                "value": "UC6_--ilWOKEWozzhFhK0WFQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-29T17:15:53Z",
                            "updatedAt": "2024-12-29T17:15:53Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "rCGWu9JQvUUZtzrloMNAhhKutTk",
                "id": "Ugw1xXa5aM37KA9Gy594AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "kshkycSaRDdUlxWcu4vojfHDzlY",
                        "id": "Ugw1xXa5aM37KA9Gy594AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Never hesitate to tell the hard truths. I really appreciate zero1. Thank you every one for priceless and life-saving content. One more thing in need to mention Pratheek sir has transformed too well in his fitness💪👏.",
                            "textOriginal": "Never hesitate to tell the hard truths. I really appreciate zero1. Thank you every one for priceless and life-saving content. One more thing in need to mention Pratheek sir has transformed too well in his fitness💪👏.",
                            "authorDisplayName": "@sudeepkolavi3391",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_meLtS1C8gl1i7ctdw977aqXq65ZlRYz3nJcpNHxhajLNpRpb2AVHlBghoDuIef2xu6gQ=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@sudeepkolavi3391",
                            "authorChannelId": {
                                "value": "UCG4vi6_pMnW5QLLctGUJEYA"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-29T17:09:19Z",
                            "updatedAt": "2024-12-29T17:09:19Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "IGQOycHXcKaZEMkw3veJ-Q95EXE",
                "id": "UgwlT1N0ngZFKZ_irPV4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "PYWkbmJDsoFUCg7uKI4CIcZwg3I",
                        "id": "UgwlT1N0ngZFKZ_irPV4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "12 is a lot. Try 2",
                            "textOriginal": "12 is a lot. Try 2",
                            "authorDisplayName": "@architagrawal9481",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_lFUoajUWZH1sboq73dSPhJRakc_xeJ96shbSqzVNE=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@architagrawal9481",
                            "authorChannelId": {
                                "value": "UCh0-PxrPr0E5P_pXx1AYmng"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-29T15:13:59Z",
                            "updatedAt": "2024-12-29T15:13:59Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "HQANCjwEQXrAiP_maT_3U-aQqnA",
                "id": "UgwxRtS9ntehETFAqIt4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "kSlvZ20dR8G6zApYEqhLCdPDnzM",
                        "id": "UgwxRtS9ntehETFAqIt4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Zero Debt , No Social Media &amp; No Credit card will almost be against the law within the next decade 🤔",
                            "textOriginal": "Zero Debt , No Social Media & No Credit card will almost be against the law within the next decade 🤔",
                            "authorDisplayName": "@navs432",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_mdCFaSn-nms-FwpmsFC5D_KRTgCPA25-j6z67zZw5ssoDw=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@navs432",
                            "authorChannelId": {
                                "value": "UC636nHZAkI12mEPAji_Rh9g"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-29T10:35:48Z",
                            "updatedAt": "2024-12-29T10:35:48Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "oU770oEsZ3uJpwTFGP1z9I0xPjE",
                "id": "UgzfJACjYW2ebw5xAUx4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "npdbSEfVMaTYJ-MLcDGNk9uc_lA",
                        "id": "UgzfJACjYW2ebw5xAUx4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Nice touch to go ad-free on this video if that was intentional :-P <br>Also the bgm crescendo at the end!<br>Appreciate the efforts behind :)",
                            "textOriginal": "Nice touch to go ad-free on this video if that was intentional :-P \nAlso the bgm crescendo at the end!\nAppreciate the efforts behind :)",
                            "authorDisplayName": "@TheGuhan1804",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_k0Mcq4Kz1v_1TVGbq8kfaD-9iul5_KGoBVsGj1uy4=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@TheGuhan1804",
                            "authorChannelId": {
                                "value": "UC29a-QqNYZDFAomzYD986Qg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 2,
                            "publishedAt": "2024-12-29T09:58:28Z",
                            "updatedAt": "2024-12-29T09:58:28Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "UVxf5T2VCl5sx3iCG34k1XnNwQo",
                "id": "UgzSdzZ8ZH3iD2rm06F4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "8xa-4c3MhKfFzx4WLgzJUFSRUzU",
                        "id": "UgzSdzZ8ZH3iD2rm06F4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Pehle zen z kamay toh sahi",
                            "textOriginal": "Pehle zen z kamay toh sahi",
                            "authorDisplayName": "@vishwasreddy7871",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_mEuDIjB8Q_LdzWJAZ5VQX9QDoglPzBPhrY1ohU5oYGH4c=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@vishwasreddy7871",
                            "authorChannelId": {
                                "value": "UCD1bZP8V9Rgpghc4dV_RBug"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-29T08:49:28Z",
                            "updatedAt": "2024-12-29T08:49:28Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "5dGgfPCThAZykhHhNRrx-VfWWmI",
                "id": "UgwYj_UnshVUoKgRgcl4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "adi89BYIwH7GrLtg_2XK1H_RDfs",
                        "id": "UgwYj_UnshVUoKgRgcl4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "earning &quot;more&quot; doesn&#39;t mean anything when money itself is loosing value everyday.",
                            "textOriginal": "earning \"more\" doesn't mean anything when money itself is loosing value everyday.",
                            "authorDisplayName": "@anonmuyous",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_lu7gbZQYy-_F0xsWGpsWHzHqQnBlKeiYNKoA197Gz4kr0=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@anonmuyous",
                            "authorChannelId": {
                                "value": "UChFYdYyA9g0qpBG-Oe7tffg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-29T08:10:34Z",
                            "updatedAt": "2024-12-29T08:10:34Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "FYV_ytB-tiNkXGHYRa2Ex-DbqvY",
                "id": "UgwBbW592HaranjGBfN4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "D5yfHTJyghy91P2f5jaxk61gYwc",
                        "id": "UgwBbW592HaranjGBfN4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "One of the best edited video, loved each part of it. May the upcoming generation learn from these mistakes and make better choices going ahead! Thank YOu for leading a change! 💯",
                            "textOriginal": "One of the best edited video, loved each part of it. May the upcoming generation learn from these mistakes and make better choices going ahead! Thank YOu for leading a change! 💯",
                            "authorDisplayName": "@08pkz",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_nxnjKcBw0JpXuJyQgITM7slNyg67AW0ynYwlPEuawlwow=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@08pkz",
                            "authorChannelId": {
                                "value": "UCwinyX1u8s0eCEe8B0qEntA"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 1,
                            "publishedAt": "2024-12-29T07:02:21Z",
                            "updatedAt": "2024-12-29T07:02:21Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "j4HhPqF2uJ50K7dE65gbX3xOv_k",
                "id": "UgxIVs-6K5NIfE0iBFl4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "nW2QABb9fOVhogvLU9zSWovcGVA",
                        "id": "UgxIVs-6K5NIfE0iBFl4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Best channel i came across in 2024 so far.<br><br>Really the content helped a lot &amp; guided in taking the next step more clearly. <br><br>Thanks to the team for making such useful content.",
                            "textOriginal": "Best channel i came across in 2024 so far.\n\nReally the content helped a lot & guided in taking the next step more clearly. \n\nThanks to the team for making such useful content.",
                            "authorDisplayName": "@divvidgamer2832",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_lzzaA1xfXEQGpBLPeVUfn1PU-c6N6HhtZX_Pqx3vFMMw=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@divvidgamer2832",
                            "authorChannelId": {
                                "value": "UC2zEnT-DApC3hjHlrQ7-XPQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 1,
                            "publishedAt": "2024-12-29T05:34:29Z",
                            "updatedAt": "2024-12-29T05:34:29Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "ipIc9vXZAq44mE_4mPqf8rxKGco",
                "id": "Ugw3Tdg7D3S7EYMCkjZ4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "OvqVM7AIxEXRDsdqc5iMzhnik8Q",
                        "id": "Ugw3Tdg7D3S7EYMCkjZ4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Best channel i came across in 2024 so far.<br><br>Really the content helped a lot &amp; guided in taking the next step more clearly. <br><br>Thanks to the team for making such useful content.",
                            "textOriginal": "Best channel i came across in 2024 so far.\n\nReally the content helped a lot & guided in taking the next step more clearly. \n\nThanks to the team for making such useful content.",
                            "authorDisplayName": "@divvidgamer2832",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_lzzaA1xfXEQGpBLPeVUfn1PU-c6N6HhtZX_Pqx3vFMMw=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@divvidgamer2832",
                            "authorChannelId": {
                                "value": "UC2zEnT-DApC3hjHlrQ7-XPQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-29T05:34:02Z",
                            "updatedAt": "2024-12-29T05:34:02Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "QdgiNozNILIWBkQSceqJ775SJ9U",
                "id": "UgyB9-fT9okgTeWRO9p4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "VX5wpyjPpSKKZCvaNWzf2XWkzjE",
                        "id": "UgyB9-fT9okgTeWRO9p4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Best channel i came across in 2024 so far.<br><br>Really the content helped a lot &amp; guided in taking the next step more clearly. <br><br>Thanks to the team for making such useful content.",
                            "textOriginal": "Best channel i came across in 2024 so far.\n\nReally the content helped a lot & guided in taking the next step more clearly. \n\nThanks to the team for making such useful content.",
                            "authorDisplayName": "@divvidgamer2832",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_lzzaA1xfXEQGpBLPeVUfn1PU-c6N6HhtZX_Pqx3vFMMw=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@divvidgamer2832",
                            "authorChannelId": {
                                "value": "UC2zEnT-DApC3hjHlrQ7-XPQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-29T05:33:47Z",
                            "updatedAt": "2024-12-29T05:33:47Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "UsHpfyAwMH5OX9zsSwNYSAWFKas",
                "id": "UgwvtmZieo6oawdfQD54AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "3qIs9afgntMfHw0MOCYGt9XGlV0",
                        "id": "UgwvtmZieo6oawdfQD54AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "The basket of goods also had 🤫 aka kasuri methi...😁😁😁",
                            "textOriginal": "The basket of goods also had 🤫 aka kasuri methi...😁😁😁",
                            "authorDisplayName": "@moudipas8025",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_k-1xqL1snmZnwyDzV2QTm7QgWIf05HYVu_lxI3bvKA-I4=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@moudipas8025",
                            "authorChannelId": {
                                "value": "UCMyqVR06Nd6juSkfbyPp-Mg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-29T05:31:35Z",
                            "updatedAt": "2024-12-29T05:31:35Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "0nyAV1eNri9azjFnIxjTxSty-KI",
                "id": "UgzI6wJ54ZDu9dvSSuZ4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "Lt1nmgKMNLg3L4y4ASBtOKC6bzg",
                        "id": "UgzI6wJ54ZDu9dvSSuZ4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "First of all the job condition and salary itself is way low under this current govt",
                            "textOriginal": "First of all the job condition and salary itself is way low under this current govt",
                            "authorDisplayName": "@anittas224",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/gJ5S3BqvxiU3eXENaqaF6GZ7xoBzx_UuAeb5q7mQE7nXOv4lcXRapIJr0h3E4LS39citBRclTw=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@anittas224",
                            "authorChannelId": {
                                "value": "UCSZi9DUpB6ad3wwHOkj-YGQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-29T05:15:39Z",
                            "updatedAt": "2024-12-29T05:15:39Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "f3kbC9WRl776d1c0rzlnRPavEK0",
                "id": "UgwiBNNARYB8fyT-S-h4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "aiQpkgVk9lEVKbHBmMHamDpnREY",
                        "id": "UgwiBNNARYB8fyT-S-h4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Guilty of all of these mistakes and more. Anyways it&#39;s a very paowefull message. Thanks for coming out with such great content",
                            "textOriginal": "Guilty of all of these mistakes and more. Anyways it's a very paowefull message. Thanks for coming out with such great content",
                            "authorDisplayName": "@pratikdugam5612",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_nmSDR1sRaEtBX25E4IfMiK3ASy2iOid5rVa56Bc30kyY0=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@pratikdugam5612",
                            "authorChannelId": {
                                "value": "UCgaLJOpu6mBkBCEPb5nMdlw"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-29T03:39:21Z",
                            "updatedAt": "2024-12-29T03:39:21Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "VyuONjmLi3eoqGlcqcf2S3E23EA",
                "id": "Ugx3eUYmntJHrqncupB4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "Sh-tnEZRJnWepPpGY-gH_CvPTjQ",
                        "id": "Ugx3eUYmntJHrqncupB4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Last 3 year se mera lifestyle expenditure  deflation pe hain sir",
                            "textOriginal": "Last 3 year se mera lifestyle expenditure  deflation pe hain sir",
                            "authorDisplayName": "@souvikbiswas1757",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_n5zcS5xD4AqCbx_PR6IJE3q3DP09A9G6IfGTstJCbAgO0=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@souvikbiswas1757",
                            "authorChannelId": {
                                "value": "UC43pmXlyFSqJdq2xVt_l-Ww"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-29T02:27:18Z",
                            "updatedAt": "2024-12-29T02:27:18Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "n0MSpVZMTK4VBwfQzKVWRlgxX6Q",
                "id": "UgwuOr1hcEw7DbfYZVt4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "Wmju-eUrWdPqVqbROPJr8e51Foo",
                        "id": "UgwuOr1hcEw7DbfYZVt4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "amazing video graphics!!",
                            "textOriginal": "amazing video graphics!!",
                            "authorDisplayName": "@HaemantIsher",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/nnlGBRWUv0G5axnLhLo8ujOrxIJ1lS5pmNzN3zL0wM9tab3CX_dvqIGm5xyWY_E-pTMN4Nj_J9g=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@HaemantIsher",
                            "authorChannelId": {
                                "value": "UCk0MPjN-blTlUaHWyw49RDA"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-29T01:52:13Z",
                            "updatedAt": "2024-12-29T01:52:13Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "z7Zzz9lkXCdJv-j5OZS0dY1IHyE",
                "id": "UgyUUws8Rp2XoU_YG8F4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "hDQvCgDn0uIcCxUA-SfIXpqzznY",
                        "id": "UgyUUws8Rp2XoU_YG8F4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "U r not smart u are fool 😂 kyuki smart log to aapka kaat rahe hai .",
                            "textOriginal": "U r not smart u are fool 😂 kyuki smart log to aapka kaat rahe hai .",
                            "authorDisplayName": "@kumarvipinverma",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_lJMIeBAMeQlAU_CWHf55-IN-zqtGSk9ffd65RuNiFWeoY=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@kumarvipinverma",
                            "authorChannelId": {
                                "value": "UC0WygOvJauTPa_LYT0KcMmQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-29T01:14:12Z",
                            "updatedAt": "2024-12-29T01:14:12Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "xUwEqCrv83prxtnTv-RIFzqIHP4",
                "id": "UgzhdbQCykNXl2i86p94AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "XHqS8RK7opAEroG98VtdqnE9DQw",
                        "id": "UgzhdbQCykNXl2i86p94AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "For this generation saving should be deducted similar like interest or SIP as soon as salary dropped in the account .....this generation should learn delayed gratification .",
                            "textOriginal": "For this generation saving should be deducted similar like interest or SIP as soon as salary dropped in the account .....this generation should learn delayed gratification .",
                            "authorDisplayName": "@amanmeshram-m4o",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/kCEAFoCpVEUpgk7DyZLQNtm66DWS4P7H67wql6-Nw2QP5Yo6f70716UU3eFGBaiQe5ZOGRvOKAM=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@amanmeshram-m4o",
                            "authorChannelId": {
                                "value": "UC_cxKyNFF6cWw79kfMGZP8Q"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T18:54:12Z",
                            "updatedAt": "2024-12-28T18:54:12Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "JC-jJbcNutQMF1Hd76pBKiEO4SU",
                "id": "UgxrryEtxf2JzASW7l94AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "Q97yvzLRQovvcUAL_g_NcUMiM88",
                        "id": "UgxrryEtxf2JzASW7l94AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Hey Prateek, please share your computer wallpaper, looks sleek.",
                            "textOriginal": "Hey Prateek, please share your computer wallpaper, looks sleek.",
                            "authorDisplayName": "@sainayak2677",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_ngLgSSs0_j-VAEHIRxE56CqDydJoaXE1J37PKbG3bhIw8=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@sainayak2677",
                            "authorChannelId": {
                                "value": "UCz56RrPrtm5oF--SrXOwqzw"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 1,
                            "publishedAt": "2024-12-28T18:40:44Z",
                            "updatedAt": "2024-12-28T18:40:44Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "mjTUF2b2YiaPfqlV5WLH76-Wrd8",
                "id": "UgwYPwufREZmAIM6z7l4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "gPautjBkahXLeUwCm93lwfSfVuc",
                        "id": "UgwYPwufREZmAIM6z7l4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Woh toh thik hain lekin basket mei nasha??",
                            "textOriginal": "Woh toh thik hain lekin basket mei nasha??",
                            "authorDisplayName": "@DEBJITSINGHA-k9e",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_n6uXwQUZQrJSqgJ6ZF2m7yPyU86vA2cV06lZe_vIJ30N0POsPL-swpaX5qoZBX-P1M2A=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@DEBJITSINGHA-k9e",
                            "authorChannelId": {
                                "value": "UC7JM2gE35YxIy3KJ0D5RtRg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 1,
                            "publishedAt": "2024-12-28T18:09:42Z",
                            "updatedAt": "2024-12-28T18:09:42Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "EIlGApgXmdRWcGQIaKwIdW1ytdw",
                "id": "UgzjEXtQITdRLMEUxld4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "bas5D3tdKvU3NqrOuPbz4iXvPNY",
                        "id": "UgzjEXtQITdRLMEUxld4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "We are earning more then our parents, but we also have to consider inflation, my father earned 6000rs when he was at his 20s, he saved money for marriage also, he brought land at cheap rate and built hotel, which is generating money till today , and we have our house. <br><br>All of my education money is done using savings, but if i want to save today i have to get away with other dreams.",
                            "textOriginal": "We are earning more then our parents, but we also have to consider inflation, my father earned 6000rs when he was at his 20s, he saved money for marriage also, he brought land at cheap rate and built hotel, which is generating money till today , and we have our house. \n\nAll of my education money is done using savings, but if i want to save today i have to get away with other dreams.",
                            "authorDisplayName": "@randomviralshorts1501",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/gy5rHx34K0XbBi_PD6xsP7q8mWg5Vjd2z8B645o8bhuKRn33FGRvu28wVSyJilM9D4TUcYUS_w=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@randomviralshorts1501",
                            "authorChannelId": {
                                "value": "UChLoqMDmKUMku5mQ-58OzAQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T17:34:45Z",
                            "updatedAt": "2024-12-28T17:36:01Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "0P2uLmJ_gJ9SmIvOFs8wDrU-f9k",
                "id": "Ugxcg_UIvs9WvIvjg6J4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "YLTThrHd75hVUqQUWwlCVVebrB8",
                        "id": "Ugxcg_UIvs9WvIvjg6J4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Indian knows &amp; understands money after 35 years of age. That&#39;s the point when you start creating the actual wealth.",
                            "textOriginal": "Indian knows & understands money after 35 years of age. That's the point when you start creating the actual wealth.",
                            "authorDisplayName": "@rajarshighosh8813",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_nf5mM3jXiE1kPw2aTGS2VNN3SocyztclyRfKTEzUA=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@rajarshighosh8813",
                            "authorChannelId": {
                                "value": "UCvj_wvhfZ8gFz1mJ_caVpPw"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T16:53:42Z",
                            "updatedAt": "2024-12-28T16:53:42Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "lvDVmOCdM8Wi61GloL6hzoVmH6U",
                "id": "UgyLQm7oXHkGMM0F-4l4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "y-3oroWCz202RQoYscSAq2QbaAg",
                        "id": "UgyLQm7oXHkGMM0F-4l4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "why Gen Z is poor..18% on caramel popcorn😅😅 Nirmala ko  nikalo BC",
                            "textOriginal": "why Gen Z is poor..18% on caramel popcorn😅😅 Nirmala ko  nikalo BC",
                            "authorDisplayName": "@sam2303",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/YwpekJeWFcEVnuj8zziy0ctAD3anelvC8XKOS3fljUwR8PDnC7N8YsvSnQ779fu8O5bp043Ynw=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@sam2303",
                            "authorChannelId": {
                                "value": "UCI1iXaf8vyrU7My7NMle1RQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 1,
                            "publishedAt": "2024-12-28T16:30:10Z",
                            "updatedAt": "2024-12-28T16:30:10Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "xVtJ72joRhCim7yLI-Jp0_r_DUA",
                "id": "Ugw46OU1VbPErC6sTat4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "GawgnSd6h9cu70_rTNKcHWehRuE",
                        "id": "Ugw46OU1VbPErC6sTat4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Bro i still use my underwear i bought in 2021 and im still broke😢",
                            "textOriginal": "Bro i still use my underwear i bought in 2021 and im still broke😢",
                            "authorDisplayName": "@mohitsingh-qk3dl",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/mI3UUm6XCptgyxVFseDGP0YAT7HtRMfJQPjqNJPbCPON6sjb8VeHxfl95vzobiofZmPWVidNOA=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@mohitsingh-qk3dl",
                            "authorChannelId": {
                                "value": "UC2Az22hmZf8LCUu1KM0fg0g"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T15:37:54Z",
                            "updatedAt": "2024-12-28T15:37:54Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "1WDTkjJemkTEKPkGmfQ2GTbqiEY",
                "id": "UgweW0VxPlJUkH1fjf94AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "6QQrd8afUyiNH5kuL9dUdNObQLw",
                        "id": "UgweW0VxPlJUkH1fjf94AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "I don&#39;t know how to thank you for such honest and awesome content . It&#39;s need of the hour!",
                            "textOriginal": "I don't know how to thank you for such honest and awesome content . It's need of the hour!",
                            "authorDisplayName": "@ashishsarpe6805",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_k-bh2ApGtQLpd6l_FjG2ouPN5ZRxvyKPRa3BoFQf5RVow=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@ashishsarpe6805",
                            "authorChannelId": {
                                "value": "UCaFv016nIb5it4qIG8viTbg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 1,
                            "publishedAt": "2024-12-28T14:17:45Z",
                            "updatedAt": "2024-12-28T14:17:45Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "waO4J433L8V_6R1XDolu6CTrRAY",
                "id": "UgyL6dIyQ0n0IHdvnkd4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "BHAHU7HDr-lsWraMwEBs26L6Khk",
                        "id": "UgyL6dIyQ0n0IHdvnkd4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "My college going kid has spent 10K in a month on Google playstore itself whilst claiming its for project work!!! Cut off the pocket money... but to think of the distractions the Gen Z has is truly mind boggling 😢",
                            "textOriginal": "My college going kid has spent 10K in a month on Google playstore itself whilst claiming its for project work!!! Cut off the pocket money... but to think of the distractions the Gen Z has is truly mind boggling 😢",
                            "authorDisplayName": "@venbas2",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_k2sQzLqUeQrZCSGbXR3velxN3fkqRtzVCqIXGgxyCIPAcX4N6uqXp9QzMEVxT6PSyAVn4=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@venbas2",
                            "authorChannelId": {
                                "value": "UCgJ0W3aEKszVUdK2DZ3XenA"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T14:00:52Z",
                            "updatedAt": "2024-12-28T14:00:52Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "m3H4zEEzI-Z8LottsIdOglB0Y1M",
                "id": "UgyVC1Ma4eCs5SiWzet4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "RmMQeh36bj3dKcRB_2qstVcF_NA",
                        "id": "UgyVC1Ma4eCs5SiWzet4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "oor do modi ko vote<br>😂😂😂😂😂😂",
                            "textOriginal": "oor do modi ko vote\n😂😂😂😂😂😂",
                            "authorDisplayName": "@ashrafkhadri2317",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_mGpjTHe-ZXOiPKlJgj6diaWPy6h7gfZyI8Xi59FRQy8Uc=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@ashrafkhadri2317",
                            "authorChannelId": {
                                "value": "UChIcNHjzX2I-RuV5tVpIrow"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T13:46:00Z",
                            "updatedAt": "2024-12-28T13:46:00Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "G-_kdrmdTl3UpopR1HbNQmfBoxc",
                "id": "UgxO3JjAY99V2TmZMT54AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "YhSj-CjGPLu9mThiwBt-DOGNN1Y",
                        "id": "UgxO3JjAY99V2TmZMT54AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "someone please give contact info this channels editor",
                            "textOriginal": "someone please give contact info this channels editor",
                            "authorDisplayName": "@someshkharat5667",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_klR9yEQLdKMjjSw9k8Ic5PHqn7oXMym7iTK_iUtbTM80bK=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@someshkharat5667",
                            "authorChannelId": {
                                "value": "UChkK0FBI5PJiUxJCFruP7pQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T13:36:04Z",
                            "updatedAt": "2024-12-28T13:36:04Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "T1C3ZY_qYw7zSEwAzqHwSETQTUE",
                "id": "UgzXNgMKp8tF2SVy2z54AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "yKftunhYqMm3bak4SNfrNEbsG30",
                        "id": "UgzXNgMKp8tF2SVy2z54AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "A new trick that i found out as a software developer. If you use instagram on the web, you won&#39;t get ads related to things that you search, whereas the Instagram app will instantly give your ads related to your chats and search",
                            "textOriginal": "A new trick that i found out as a software developer. If you use instagram on the web, you won't get ads related to things that you search, whereas the Instagram app will instantly give your ads related to your chats and search",
                            "authorDisplayName": "@JashDoshi",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_lvvr0cqtFHQBm0MJoR-ozUnyfF-iPqQhFddBI-bQTwFyc=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@JashDoshi",
                            "authorChannelId": {
                                "value": "UCuQMXbDHqjjYnus51eqO-Kg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 2,
                            "publishedAt": "2024-12-28T12:19:29Z",
                            "updatedAt": "2024-12-28T12:19:29Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "n9eDpaH2vbRzWICRQ5JhBuL2YtI",
                "id": "UgztCAnDa2pWTvOf7494AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "98cTP3UjsA7cSMiHFmVfzw4pQ9o",
                        "id": "UgztCAnDa2pWTvOf7494AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "The editing of this video is incredibly satisfying to watch and appears professionally done! ✨",
                            "textOriginal": "The editing of this video is incredibly satisfying to watch and appears professionally done! ✨",
                            "authorDisplayName": "@snowymuffin",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/DGF6R7uV8cClmCD50u88hUYhv3fn20Z59R4YGMWzhUomI6Q1nU-OTfElwgeu8ExPswTush2K=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@snowymuffin",
                            "authorChannelId": {
                                "value": "UCB2W2zbXWo1qnG_KP8Mnyyg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 4,
                            "publishedAt": "2024-12-28T11:55:23Z",
                            "updatedAt": "2024-12-28T11:55:23Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 1,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "lLRrq1uhjDNB0zwHAwRrDqlk46w",
                "id": "UgzbTYxjxn9Cf25R01R4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "P1-b2j-dw_uvQLAa9KprJbtfIaY",
                        "id": "UgzbTYxjxn9Cf25R01R4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "12 young people between 23 and 27 across 6 cities? That’s a really poor sample size. Not to mention this won’t result in understanding any sort of inference.",
                            "textOriginal": "12 young people between 23 and 27 across 6 cities? That’s a really poor sample size. Not to mention this won’t result in understanding any sort of inference.",
                            "authorDisplayName": "@Rubitonyourface",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/wJA0TMilPwDLP4QYOYm9xaxAX4u4Ut45rtDcx8oB-YITtSTq9xq6ygWzSwXmI4eZb9eXIvZx=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@Rubitonyourface",
                            "authorChannelId": {
                                "value": "UCMnD0bTg8T73FYSNFcxmp0g"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 3,
                            "publishedAt": "2024-12-28T11:23:15Z",
                            "updatedAt": "2024-12-28T11:23:15Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "dXykn3FVe15bgpe8-G3ZZ3y58_s",
                "id": "Ugzl9pNfGy6mFLnMWEt4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "UD2mAAoPNgvZUkyeqGgDy8feBUk",
                        "id": "Ugzl9pNfGy6mFLnMWEt4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "<a href=\"https://www.youtube.com/watch?v=8iaaeTDTO9E&amp;t=12\">0:12</a> wow! A grand total of twelve people. Such a large pool of people to reliably conclude gen Z is poor.",
                            "textOriginal": "0:12 wow! A grand total of twelve people. Such a large pool of people to reliably conclude gen Z is poor.",
                            "authorDisplayName": "@faihan988",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_nAYW7Bov_CFBWbOhe3ZzmoquT2WrMGH6QW9ch0SeUw9fR_=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@faihan988",
                            "authorChannelId": {
                                "value": "UCFC8QBWIBsaJCoTojYtS9ZQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 21,
                            "publishedAt": "2024-12-28T10:21:45Z",
                            "updatedAt": "2024-12-28T10:21:45Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 3,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "Q13Cr7Ln0RxQhWlS6BKpsG2CNhI",
                "id": "UgyuoHNSxchAwabgT-p4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "KPV36uiaKP6Mlf_uLbZKCYAkH8E",
                        "id": "UgyuoHNSxchAwabgT-p4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "We also pay more taxes than our parents and we are taxed on several instances of purchasing so....",
                            "textOriginal": "We also pay more taxes than our parents and we are taxed on several instances of purchasing so....",
                            "authorDisplayName": "@kavitaiyer9971",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_kuP3Vs8UzSPZT0BRLgvFixBix824cfw_RcwMAdHxNF_-cy=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@kavitaiyer9971",
                            "authorChannelId": {
                                "value": "UC9SOWmtLLbWH4QPLt07R8Zg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T09:15:45Z",
                            "updatedAt": "2024-12-28T09:15:45Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "k1NkD_XA1hT1ndtHwHjZLx3o9oI",
                "id": "UgwZgBDdcRZ9J4ZPEyB4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "2qgaYp5uCg1dSCpwIPPcMpm_IfM",
                        "id": "UgwZgBDdcRZ9J4ZPEyB4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Aboslutely Brilliant Stuff and Examples....every GenZ kid should watch this video.",
                            "textOriginal": "Aboslutely Brilliant Stuff and Examples....every GenZ kid should watch this video.",
                            "authorDisplayName": "@deltaforce29",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_nWsp__78Cu7XxKgP0FgZPquWa8zzzfPREthCYBdgTe4Q=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@deltaforce29",
                            "authorChannelId": {
                                "value": "UCjfO0lzWbby6BJegQRMLHoQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T08:55:06Z",
                            "updatedAt": "2024-12-28T08:55:06Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "ai98W1pHONE2C0Aylfk8rlhF2d0",
                "id": "Ugz0_V-as-9MpEW3C1x4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "6CiC4ELyaB_xFDzSxddsGothLm4",
                        "id": "Ugz0_V-as-9MpEW3C1x4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "The issue is with efforts, Millenials &amp; GenZ dont want to put efforts, the companies are actually selling convenience and not food/groceries/any product. Its just a weaker generation after a strong generation.<br>Hard times create strong men, strong men create good times, *Good times create weak men*, Weak men create Hard times.",
                            "textOriginal": "The issue is with efforts, Millenials & GenZ dont want to put efforts, the companies are actually selling convenience and not food/groceries/any product. Its just a weaker generation after a strong generation.\nHard times create strong men, strong men create good times, *Good times create weak men*, Weak men create Hard times.",
                            "authorDisplayName": "@anirudhabrv1",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_mt8pAxKzkCDLQw5G2x_C0Hi7ORiShXI_Z8LVG80y09rw=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@anirudhabrv1",
                            "authorChannelId": {
                                "value": "UCrAlAAgXuBxc57viV6eTR3g"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T08:45:53Z",
                            "updatedAt": "2024-12-28T08:45:53Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "6dCfoh4df5kltqijgmPtMgPBcrs",
                "id": "UgwvK0jVqyLYc_Xc0k94AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "QApuX26ZPvZTACgaCcQfyZoob-A",
                        "id": "UgwvK0jVqyLYc_Xc0k94AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Man that was so insightful, although we all know what is right or wrong",
                            "textOriginal": "Man that was so insightful, although we all know what is right or wrong",
                            "authorDisplayName": "@champ_champ",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_mLMKsQ4Z42YkAk6odYD2LwiUxo4WUoPh89uZ42getDie0=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@champ_champ",
                            "authorChannelId": {
                                "value": "UCwxxoW4hy_2NcVxtC4UQ0Wg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T08:43:16Z",
                            "updatedAt": "2024-12-28T08:43:16Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "8g8uJ0zBv1oofbYwH94spdKh6bw",
                "id": "Ugw6DX1uZMb7RksAHBB4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "bJIFIpzYvucK5y8MhqMwujIO5rc",
                        "id": "Ugw6DX1uZMb7RksAHBB4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Extremely insightful and relatable, can we have the link to studies and research papers mentioned",
                            "textOriginal": "Extremely insightful and relatable, can we have the link to studies and research papers mentioned",
                            "authorDisplayName": "@shubhamagarwal8981",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/N8eZ62DZ57brMMGlEjeuPX1jxi4hx7xKnFoxLt5V_8fxp5RxJf-Wh2BLqFer0hVeN4wkdJrm9Xo=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@shubhamagarwal8981",
                            "authorChannelId": {
                                "value": "UCWhB4leRZc5dk-VZkFRLKLg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T08:02:20Z",
                            "updatedAt": "2024-12-28T08:02:20Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "F_a5nLInGtlbUE5dlhwOUhCZcg8",
                "id": "Ugxxne7ymCkvcQHgjAN4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "NIz8YavQn0ob2ZeMChTw9NtLA4Q",
                        "id": "Ugxxne7ymCkvcQHgjAN4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "I think you missed the biggest point, which you started off with initially. It’s that even though we are earning more but prices of goods (assets mostly) have been raised to such high levels by corporations that gen z can never afford to own them. So to get the small pleasures in life people look at what they can buy and that’s where the rest of the video continues",
                            "textOriginal": "I think you missed the biggest point, which you started off with initially. It’s that even though we are earning more but prices of goods (assets mostly) have been raised to such high levels by corporations that gen z can never afford to own them. So to get the small pleasures in life people look at what they can buy and that’s where the rest of the video continues",
                            "authorDisplayName": "@thesahilk",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_lJ0bcFO7uJHz7Qv2JK5yDB66S4u6G9EeAps8cFCgldnNWU=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@thesahilk",
                            "authorChannelId": {
                                "value": "UCMXW6TJJQ1yOIm5HWmDq-cg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T07:50:52Z",
                            "updatedAt": "2024-12-28T07:50:52Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "W5ZouGor5khvDMbcpAmcAMIitJE",
                "id": "Ugzt5dTKG2GQ4VsqUmN4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "7b8MbT1wZzO4h_2-5hhCVVcBK-g",
                        "id": "Ugzt5dTKG2GQ4VsqUmN4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Very insightful video!! Now can I have that cool t-shirt you are wearing?",
                            "textOriginal": "Very insightful video!! Now can I have that cool t-shirt you are wearing?",
                            "authorDisplayName": "@vichitra-yt",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_npHfu2ephH4g9R5_wzwc4CNOH4jwqN5Ue_5Ic8gpFBjH4UblrZqlqsH43m4hf_S9zf-g=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@vichitra-yt",
                            "authorChannelId": {
                                "value": "UCtgrEz3UFcFJ5E2zG5dQtfg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T07:30:47Z",
                            "updatedAt": "2024-12-28T07:30:47Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "FBjnbPnD2BsckVU_GmZtCL51D_Q",
                "id": "UgxZZz_G-FoPrMo5d9J4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "qAIfaanBAIEDpS2uErgrhkCiarY",
                        "id": "UgxZZz_G-FoPrMo5d9J4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Kudos for showing the dark reality of High-Fi life of this Generation.<br>This is happening with almost 90% of the youth across the world.",
                            "textOriginal": "Kudos for showing the dark reality of High-Fi life of this Generation.\nThis is happening with almost 90% of the youth across the world.",
                            "authorDisplayName": "@arjunrebel4946",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_mr6ynESk3EDWSv4l1URy-qL4sZY4a-oXYw-LAukglgFQg=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@arjunrebel4946",
                            "authorChannelId": {
                                "value": "UCY_Qf_mEkRL9UeAaSSoSx7w"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 1,
                            "publishedAt": "2024-12-28T07:18:56Z",
                            "updatedAt": "2024-12-28T07:18:56Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "YEvlaU1CbyT5OIE8x5qYgIn7ilE",
                "id": "UgwUbzH54uhDjywbIVJ4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "fuEszgx3oqCNUKLnqCB8QmUafUI",
                        "id": "UgwUbzH54uhDjywbIVJ4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "the background music was so cool, thanks for the information btw",
                            "textOriginal": "the background music was so cool, thanks for the information btw",
                            "authorDisplayName": "@ashraf_isb",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/qv-sdOtgsKuzY7UjeUGD3efS6nbYpo0Zn0fz63qvJQMBBeXw3mR6QleoygvRDq53xGxxt8Dm7w=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@ashraf_isb",
                            "authorChannelId": {
                                "value": "UCtQqQonTshTx2SfbXJuVkTA"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 1,
                            "publishedAt": "2024-12-28T07:13:33Z",
                            "updatedAt": "2024-12-28T07:13:33Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "fl_WoTJgqCNrBFLmnTeCRBJZgHc",
                "id": "UgzG7h-GiZvwZG9xp7B4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "StfLOzvm3sZqC7BcqaK2WO4vi2I",
                        "id": "UgzG7h-GiZvwZG9xp7B4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Totally agree! Social media, easy credit, and rising living costs make it hard to save or get ahead. Financial education is key for us to break the cycle.",
                            "textOriginal": "Totally agree! Social media, easy credit, and rising living costs make it hard to save or get ahead. Financial education is key for us to break the cycle.",
                            "authorDisplayName": "@binayakcreations",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_neXAuwMiyg19O5ApqFe0jKvJxxhaoCVwZ2SLjucbDSbxU=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@binayakcreations",
                            "authorChannelId": {
                                "value": "UCe2ALPLeroyHrYTB2N_cxfQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T06:29:57Z",
                            "updatedAt": "2024-12-28T06:29:57Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "Gy1nGWRaHrZ1TDMQK5XYnmgM17M",
                "id": "UgxHqHjLxZBLU87vmQZ4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "amWWbGePqyCI3bnYWT1KU-qD0g4",
                        "id": "UgxHqHjLxZBLU87vmQZ4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "As mentioned earlier in the video tht the said  girl had a dream to build her parents their own home. <br>As a post graduation studying student ( soon to be employed) who do want to save money to build a home for their parent... I&#39;d like see a video explain what are the ways to save for that goal. <br><br>I have gone through al the videos in ur channel.. and searched million videos to save.. but evrything comes up and says how do we pay the emi..",
                            "textOriginal": "As mentioned earlier in the video tht the said  girl had a dream to build her parents their own home. \nAs a post graduation studying student ( soon to be employed) who do want to save money to build a home for their parent... I'd like see a video explain what are the ways to save for that goal. \n\nI have gone through al the videos in ur channel.. and searched million videos to save.. but evrything comes up and says how do we pay the emi..",
                            "authorDisplayName": "@likeareader",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/qBqi9UH3XN7ArV0h1PDM6gD12WTOGI39YMSioSs1VQFUz-SCHujrT5dRYINb2E5ybhm7XZhK=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@likeareader",
                            "authorChannelId": {
                                "value": "UCXMzmnfF3yLFetMQ_fDR2fg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 1,
                            "publishedAt": "2024-12-28T06:10:32Z",
                            "updatedAt": "2024-12-28T06:10:48Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 2,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "QzKpFlhS9H30yJ0IxPmYw0mixc4",
                "id": "UgzHyY7HdROnKqRVSPJ4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "m467vQMOn6dSsSC4hRfX-czPVZo",
                        "id": "UgzHyY7HdROnKqRVSPJ4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Gen Z&#39;s don&#39;t want to regret their decisions so they buy another problem to balance previous mistakes. The point is there is no point in this Gen Z situation, Gen z&#39;s are past saving😂.",
                            "textOriginal": "Gen Z's don't want to regret their decisions so they buy another problem to balance previous mistakes. The point is there is no point in this Gen Z situation, Gen z's are past saving😂.",
                            "authorDisplayName": "@NithinMSV",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_lHIObXNavPFxohlFj8dzkpiKmb5ON5rOJTESXMg9bvK5Y=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@NithinMSV",
                            "authorChannelId": {
                                "value": "UCzBxeppyHFOdvVy2tsJmOQA"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T05:57:10Z",
                            "updatedAt": "2024-12-28T05:57:10Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "T6T3Bus_4K6c6IivJHzyUAF6iv8",
                "id": "UgyTcm3dklmnyy2uoKl4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "lsKHLLJvp1Jla5Mjaszoz0Bl-mk",
                        "id": "UgyTcm3dklmnyy2uoKl4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "11 lacs is a lot of money. And the scary part is it is consumption and not some investment. No body in their right minds should spend more than 60% of their salary on discretionary spending.",
                            "textOriginal": "11 lacs is a lot of money. And the scary part is it is consumption and not some investment. No body in their right minds should spend more than 60% of their salary on discretionary spending.",
                            "authorDisplayName": "@satvikkhare1844",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_mjoDwu9hrvfx2tBGbGK7GhnTPRTpnajtJ2ICXFgEw=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@satvikkhare1844",
                            "authorChannelId": {
                                "value": "UCaaGIDJdbOgTQETGLUmJpfw"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T05:47:07Z",
                            "updatedAt": "2024-12-28T05:47:07Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "yL94vI_-FDJIngkaC9faJNeCm4M",
                "id": "UgzNQsPRh4QArTlXlK54AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "JGqbGvwOZFkhBet_Dye9MLHZFUU",
                        "id": "UgzNQsPRh4QArTlXlK54AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "All of this lecture after wearing the most expensive iwatch, what an irony",
                            "textOriginal": "All of this lecture after wearing the most expensive iwatch, what an irony",
                            "authorDisplayName": "@snehaljanwe5086",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_l7epNHukhq4de2Sx24rFMzDTPJNycqtXpyQTheS08=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@snehaljanwe5086",
                            "authorChannelId": {
                                "value": "UCobE0TnUicR8w__1K-CQj1w"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T05:35:50Z",
                            "updatedAt": "2024-12-28T05:35:50Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "ZODh8tde3gSiOyfcf4nn3cLDqRE",
                "id": "UgwoF1QAtAXheiIjtaF4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "FKgjS4JIkhbZM24nHKTmzqkAp1E",
                        "id": "UgwoF1QAtAXheiIjtaF4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Good one about taking control!<br><a href=\"https://www.youtube.com/watch?v=Rim2rXIbVoA\">https://youtu.be/Rim2rXIbVoA?si=mqiZX9MyfDTIFjmH</a>",
                            "textOriginal": "Good one about taking control!\nhttps://youtu.be/Rim2rXIbVoA?si=mqiZX9MyfDTIFjmH",
                            "authorDisplayName": "@dextor5879",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_nBn0z4UiOmB16WZ5q5URYpSmh9Z8Y_ZaYNZxezTzQ_MfA=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@dextor5879",
                            "authorChannelId": {
                                "value": "UCmOBWb4Cyq2unhIbyCQY42Q"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T05:28:57Z",
                            "updatedAt": "2024-12-28T05:28:57Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "0bKEtqgSDbhQlWycZ4LyTVjXw5g",
                "id": "Ugyu5ZfHC_klIf-SRvN4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "TzWlprkNdU5zEN26P1ne79y8O-0",
                        "id": "Ugyu5ZfHC_klIf-SRvN4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "People not able to keep money calmly has always been there <br>its just easier to purchase things today",
                            "textOriginal": "People not able to keep money calmly has always been there \nits just easier to purchase things today",
                            "authorDisplayName": "@viratforever21",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_kGN786AD5ysp8Iqw58gSmScgwzPS9PeIbTJzDEVfeTQFXvVp3GYqlOinFLN8aH216_Fw=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@viratforever21",
                            "authorChannelId": {
                                "value": "UCmaSjwoloazFimotnCwY_ow"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T05:26:31Z",
                            "updatedAt": "2024-12-28T05:26:31Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "ZQntGqzEklnAKH8OIrKzK3xkPAw",
                "id": "Ugw578trxScWll_H4aV4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "apfF8FasFrL1g9F_lfNlHUza0vc",
                        "id": "Ugw578trxScWll_H4aV4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "This is a Gendu generation! 🫶",
                            "textOriginal": "This is a Gendu generation! 🫶",
                            "authorDisplayName": "@VikramDattu1991",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_mR2YZ_LH_4Ymnn87i1zulslk6xwpUuqcFFNiyJVOQ7SDI=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@VikramDattu1991",
                            "authorChannelId": {
                                "value": "UCLGQDEwyb1esNtV48Di8olg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T05:22:18Z",
                            "updatedAt": "2024-12-28T05:22:18Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "r33BytdmKmuV8u0xSshrs23vT70",
                "id": "UgxHWjQvjZvt20uo6QV4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "q4KUiyZVxuKzEatlRWTB9U26jeo",
                        "id": "UgxHWjQvjZvt20uo6QV4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "nah bro is joking when he is saying &quot;our generation&quot; while he is a straight millennial",
                            "textOriginal": "nah bro is joking when he is saying \"our generation\" while he is a straight millennial",
                            "authorDisplayName": "@Charan-yr9te",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_lxmR2z9x-pzuDlsQfgQVNbaPE4cdxieqNmMyvaJpnXRzw=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@Charan-yr9te",
                            "authorChannelId": {
                                "value": "UCcyNXTxgZv56fN6Q_Jq_m_w"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T05:14:19Z",
                            "updatedAt": "2024-12-28T05:14:19Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "_mdvR55COxDEEnuhscEL8YXJBRE",
                "id": "Ugyvn-z8IvfSOn10EyN4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "TLskMebJWU_e6F6586oWJmbsiHs",
                        "id": "Ugyvn-z8IvfSOn10EyN4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "The monitor on the right is distracting..",
                            "textOriginal": "The monitor on the right is distracting..",
                            "authorDisplayName": "@shivajibhosale7964",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_m0GB8FqtCDNn4_FePX7U2JEPgKyHe96OMlRdEVvQsf1-8=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@shivajibhosale7964",
                            "authorChannelId": {
                                "value": "UC7AahpigKs8fj4qJbydVD1w"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T04:55:47Z",
                            "updatedAt": "2024-12-28T04:55:47Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "o6v8MGrvTloKISMdfHnNw9t2zso",
                "id": "Ugw0JUaBWC5anUv8att4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "1m812m_4KeEu6FCLP8p3iYrSvW8",
                        "id": "Ugw0JUaBWC5anUv8att4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "7/10 iphones on EMIs is a strong indicator of something is seriously wrong",
                            "textOriginal": "7/10 iphones on EMIs is a strong indicator of something is seriously wrong",
                            "authorDisplayName": "@riteshgarg",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_nBiBza47xrVI22HQqbI5vVMSjOKCrypMV0wpODLhDTVe4Nl2G7EKpFmagMA2FW4bucAg=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@riteshgarg",
                            "authorChannelId": {
                                "value": "UCqqJucrk2hFpWk5QslHBzUA"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 3,
                            "publishedAt": "2024-12-28T04:46:27Z",
                            "updatedAt": "2024-12-28T04:46:27Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "_jACZzaBFCOIVsi5NJj3t_CuKtU",
                "id": "UgyKPFDr-83KUE3MZZJ4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "aru37DxxNwhyZQ9BHJGq-R_QuHU",
                        "id": "UgyKPFDr-83KUE3MZZJ4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Too small sample size",
                            "textOriginal": "Too small sample size",
                            "authorDisplayName": "@SwapnilPupulwad-t4s",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_mA5iYFWQWr-erQfOrpRSPi7uAL1ykOBKRSbPBDp88Z1xyBT7Je5IKp6_AckwgwsDEc-Q=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@SwapnilPupulwad-t4s",
                            "authorChannelId": {
                                "value": "UC1DbB4wYc7A6QTcSe5cdcnw"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T04:33:21Z",
                            "updatedAt": "2024-12-28T04:33:21Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "MMLfwE_H80ruhWcr4HG6VjBhy0I",
                "id": "UgzxnVpJ7TPC8ZtYe-p4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "ERsLEuHVDYh6s1NVYt5-Qd1kS1Y",
                        "id": "UgzxnVpJ7TPC8ZtYe-p4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Everyone is advertising and making youtube videos on a topic nothing else..<br>Pretty sure no one has any money alearnee atleast in india in age of 21-23<br>So why genz would be",
                            "textOriginal": "Everyone is advertising and making youtube videos on a topic nothing else..\nPretty sure no one has any money alearnee atleast in india in age of 21-23\nSo why genz would be",
                            "authorDisplayName": "@vaibhav5163",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_lhGdoWpWVVYyxL5Zm4zem0CHHgl9OiMpgsWEy4DbuldYiozl4RBuMXZCnp4QWk06cKVQ=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@vaibhav5163",
                            "authorChannelId": {
                                "value": "UCfqmTQFvZQaDmJx6GLse0Fw"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T04:32:56Z",
                            "updatedAt": "2024-12-28T04:32:56Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "ssLs5Zr5CDIpcPpcIWWUdISEVRM",
                "id": "Ugz6IjPa41sN_5X8jbt4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "iwerv4Ky1pUb47fHwWewwC-fVXY",
                        "id": "Ugz6IjPa41sN_5X8jbt4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "gen z is from 95 - 2010 and gen alpha is 2010 - 24 onwards",
                            "textOriginal": "gen z is from 95 - 2010 and gen alpha is 2010 - 24 onwards",
                            "authorDisplayName": "@darkvader125",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/LFK6M24Fb_41nkY9cSATQQ3WohR1E1B29Ai1KA_jyITL80szg3bvOXThTXPeWvnjWhcu_0_8Vw=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@darkvader125",
                            "authorChannelId": {
                                "value": "UCWsPeTAwG3Tw-TT4_oZd-6g"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T04:25:39Z",
                            "updatedAt": "2024-12-28T04:25:39Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "CsugXR3Y_EPBirPbrS6W1fNzhp8",
                "id": "UgzQiXChLSyZ0Yh-rE94AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "Ags-9WQvBznSWpdmhO4LvRhL1wE",
                        "id": "UgzQiXChLSyZ0Yh-rE94AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "as gen early gen z i can understand",
                            "textOriginal": "as gen early gen z i can understand",
                            "authorDisplayName": "@darkvader125",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/LFK6M24Fb_41nkY9cSATQQ3WohR1E1B29Ai1KA_jyITL80szg3bvOXThTXPeWvnjWhcu_0_8Vw=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@darkvader125",
                            "authorChannelId": {
                                "value": "UCWsPeTAwG3Tw-TT4_oZd-6g"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T04:22:42Z",
                            "updatedAt": "2024-12-28T04:22:42Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "aZJNBNSL23-wu1zEWF1BUjOnbFo",
                "id": "UgxG9RBK72ggZuST_YB4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "PeD1iB9JNW95rVoHDgL8t8Vz_hI",
                        "id": "UgxG9RBK72ggZuST_YB4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Hey zerodha, tell me this.<br>Imagine you got your bonus of 50k, and you have it in your bank account. Whenever you want to make any purchases, you do it from this but make sure that every month end, you recover the difference from your salary... <br>Fundamentally, how is this different than BNPL?",
                            "textOriginal": "Hey zerodha, tell me this.\nImagine you got your bonus of 50k, and you have it in your bank account. Whenever you want to make any purchases, you do it from this but make sure that every month end, you recover the difference from your salary... \nFundamentally, how is this different than BNPL?",
                            "authorDisplayName": "@RajveerSingh-vf7pr",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_lLBUt7uL_wsZ7wlLUftQp-2e0At1hiQkUN9epo83c=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@RajveerSingh-vf7pr",
                            "authorChannelId": {
                                "value": "UCK3LhciKlPEXAJ2itcpT42w"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T04:11:55Z",
                            "updatedAt": "2024-12-28T04:11:55Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "jJaYcq7FKaWJLLirq-iMXogGvjI",
                "id": "UgxZv3q3qux6jqODfFt4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "SuN-7-pV4RDcwB3MBmzSJwioY9U",
                        "id": "UgxZv3q3qux6jqODfFt4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Based on what you are saying they are poor ? Means which number show this ?",
                            "textOriginal": "Based on what you are saying they are poor ? Means which number show this ?",
                            "authorDisplayName": "@meetsugat9510",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_lqsGu6c3mPLvXhNNsAuns_7es0VA2CxUAp5H1AOOc=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@meetsugat9510",
                            "authorChannelId": {
                                "value": "UC2N-dkJx7DSUsn6J-sumzKw"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T04:02:44Z",
                            "updatedAt": "2024-12-28T04:02:44Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "Nm0WQyUzKpHIbbJRAgeh-qfjgWc",
                "id": "Ugy3rzgpLYkMsaoxQZN4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "iaTe_7m3J4casrGaYerFFaliczE",
                        "id": "Ugy3rzgpLYkMsaoxQZN4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "I think everything adds up, they target us with tempting advertisement, then we have credit card which incentivise us to spend through milestone benefits.",
                            "textOriginal": "I think everything adds up, they target us with tempting advertisement, then we have credit card which incentivise us to spend through milestone benefits.",
                            "authorDisplayName": "@dhruvhsachdev",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/O86EOGhW60BdwkphbXA2gQ2yFWLGCIb6rouc2DtmU2oq65Yo55cwHPhXLEb-kCp-z4789N9JqEk=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@dhruvhsachdev",
                            "authorChannelId": {
                                "value": "UCQaqEiCy_KVSJZnF5PJBGPQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T04:02:29Z",
                            "updatedAt": "2024-12-28T04:02:29Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "sG3_Ji_z-QKgK3MH1NswupmZRTU",
                "id": "Ugx8drRf3Cq8Y9zZKed4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "ZFHXeyNUJ_53GxFD1WJLr2kCjkE",
                        "id": "Ugx8drRf3Cq8Y9zZKed4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "I saw my father saving money and investing it. Thank you bapu😁",
                            "textOriginal": "I saw my father saving money and investing it. Thank you bapu😁",
                            "authorDisplayName": "@rohan4600",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_mp2qBK36Bcl_CF8otPlRJfw3nxS_AHlntXTLaTY7sY5g4=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@rohan4600",
                            "authorChannelId": {
                                "value": "UCAo5c-yxJAEAFp2fld0Dndw"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T03:54:41Z",
                            "updatedAt": "2024-12-28T03:54:41Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "q1xOLabSLj7ebdeYMlGy8V555gQ",
                "id": "UgyjSu2eJlcZ_VauhFN4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "Iyl0PaRiVKYcUnd--GtkgX2W85k",
                        "id": "UgyjSu2eJlcZ_VauhFN4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "poor sia!",
                            "textOriginal": "poor sia!",
                            "authorDisplayName": "@shreejiths5731",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_mbdw79JGc5mlEFb4L_fDS_eNfnZ3cB5TODqlDQLt_5YWQ-7_FLklstw7UB2tMe0YfK6w=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@shreejiths5731",
                            "authorChannelId": {
                                "value": "UC-20pNSZpzuUvXwxgKH5tlg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T03:49:01Z",
                            "updatedAt": "2024-12-28T03:49:01Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "yAR1RCkJMAK9JURq_LKbEk2VU08",
                "id": "UgxsGV1orYH1ZoDqXTl4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "tzntqOA20VLqtUg2CZCZ24Nit-I",
                        "id": "UgxsGV1orYH1ZoDqXTl4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "What you really need is ...... Maybe nothing",
                            "textOriginal": "What you really need is ...... Maybe nothing",
                            "authorDisplayName": "@SanjayKumar-hc1ov",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_lNEZqMTXcFicO4j0NiQ7ZPgiwN3x0DnjnAFDwFWpY=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@SanjayKumar-hc1ov",
                            "authorChannelId": {
                                "value": "UCyRtaftLTv2rRBxyoTKTrSQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T03:46:05Z",
                            "updatedAt": "2024-12-28T03:46:05Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "rlyx3vklPYQ52qcdgh23lcwmFek",
                "id": "Ugysm96M7ky80PRyNfp4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "_ZK1NNpWvSEp9xwsjVDAPVjelxE",
                        "id": "Ugysm96M7ky80PRyNfp4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Sir, keep creating such informative and education videos. I watch your videos and truly appreciate your efforts and effective ways to impart the knowledge on audience. Kudos!",
                            "textOriginal": "Sir, keep creating such informative and education videos. I watch your videos and truly appreciate your efforts and effective ways to impart the knowledge on audience. Kudos!",
                            "authorDisplayName": "@KrishnarajSooji",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/zulwG6WPVGd8d_xc4DU2rZJb0TwnriLGW056IFj96vnSSVZgQlocXhY5gUMEiEvJaJm-e0TV=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@KrishnarajSooji",
                            "authorChannelId": {
                                "value": "UCp60sEGMD1-GPb7Ygrj45YA"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T03:43:04Z",
                            "updatedAt": "2024-12-28T03:43:04Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "oW7KxdFcGPLUEd3CIbuIJVoHSbk",
                "id": "UgzrXM5lRsvpROnF17d4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "q7lu9DedUi5niwFXMQWmcFEyN7E",
                        "id": "UgzrXM5lRsvpROnF17d4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Bhai Mera bhi dekh lo 26m here cracked govt job group b . One year h gye ...worked hard in private before bec was father was diagnosed with c****. Never enjoyed but have good saving now and peace of mind. I don&#39;t buy fancy stuff and keep a record of all the money that I spend.",
                            "textOriginal": "Bhai Mera bhi dekh lo 26m here cracked govt job group b . One year h gye ...worked hard in private before bec was father was diagnosed with c****. Never enjoyed but have good saving now and peace of mind. I don't buy fancy stuff and keep a record of all the money that I spend.",
                            "authorDisplayName": "@divyankdixit645",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/PN7exApcazLL_HzGwLYq63sssE0VAriYSfD4KOzJwQMY9C32sJygH04EV6XYdcA5BjEM61MwUDE=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@divyankdixit645",
                            "authorChannelId": {
                                "value": "UC4Uf6IPF-cXeDP9qkrVU94g"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T03:07:58Z",
                            "updatedAt": "2024-12-28T03:07:58Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "Drj6iFOh1PRu4z-l0SYPOQObxyQ",
                "id": "Ugz7TCpNv91QIS7j5Jp4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "dZx3KU9vNezJMsWHNdkNP8meGts",
                        "id": "Ugz7TCpNv91QIS7j5Jp4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "These smartest people aren&#39;t able to sell me anything. 80% saved every month. 😎😎😎😎<br>On the way to financial freedom by mid 30s. Best thing money can ever buy.",
                            "textOriginal": "These smartest people aren't able to sell me anything. 80% saved every month. 😎😎😎😎\nOn the way to financial freedom by mid 30s. Best thing money can ever buy.",
                            "authorDisplayName": "@wreckball2315",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/RrveCNchVAl_M1zgtH2WCo_7-cQSmEwny-kpoyaHpa5DCBChFAdhi5fajh6Y46nYa8OiDokK=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@wreckball2315",
                            "authorChannelId": {
                                "value": "UCKvlgSmBx5OYcqrju2wWRzg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T03:03:55Z",
                            "updatedAt": "2024-12-28T03:03:55Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "oO1u3Fh2xTqb0c0SCteaOW-_sB8",
                "id": "UgykOROYesYY_lVmPhF4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "FXJbPWHxXT209v9_sA218MzIx2E",
                        "id": "UgykOROYesYY_lVmPhF4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "The reason why most of the parents were able to afford build a home is buy selling land..  <br><br>My grandparents had lot of land .. which my parents sold some of them in order to build a home .  Whenever there was a money crunch they sold land .  Now we have only little bit of land left to live .<br><br>This is the case with most of the old generation how they built house . 😂😂",
                            "textOriginal": "The reason why most of the parents were able to afford build a home is buy selling land..  \n\nMy grandparents had lot of land .. which my parents sold some of them in order to build a home .  Whenever there was a money crunch they sold land .  Now we have only little bit of land left to live .\n\nThis is the case with most of the old generation how they built house . 😂😂",
                            "authorDisplayName": "@mystoganmist813",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_lkd0rxDNf5fMK_UoPYRhOsgwNtwY9ZOs1KY-dpA5QhVhAqxMEwBKhHbjPdHHUvhecsUw=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@mystoganmist813",
                            "authorChannelId": {
                                "value": "UCdzLPdNlTAfBTVq8GKTycSQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-28T02:28:04Z",
                            "updatedAt": "2024-12-28T02:28:04Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "8fNYSHbEpqeOwdErdZc6l0zrBjE",
                "id": "UgwN7YFfFpaeq4fRf5V4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "B4DLZjsde3uoj0rkA1qyDEOvHdA",
                        "id": "UgwN7YFfFpaeq4fRf5V4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Combining whole zen g loan big industrialist loan has been waved off by bank😂, but no one has gut to make video about them😅. Now youtube is becoming a mental garbage dump yard.",
                            "textOriginal": "Combining whole zen g loan big industrialist loan has been waved off by bank😂, but no one has gut to make video about them😅. Now youtube is becoming a mental garbage dump yard.",
                            "authorDisplayName": "@gkcse27",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_nMqwAXt1mO_Bdb6WBYw0SwE7TYpkXeRx71Id3WwNfDZPE=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@gkcse27",
                            "authorChannelId": {
                                "value": "UCvYLdPm5hxkOz_BXToN-lVA"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 1,
                            "publishedAt": "2024-12-28T02:12:56Z",
                            "updatedAt": "2024-12-28T02:12:56Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "ZXEGvRpRFaYOh2O_1vW1g3ofAMM",
                "id": "UgzEP3eRlzJYQBmT-kF4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "NJeY3KmgmM44rXiOipkuqBp6LF8",
                        "id": "UgzEP3eRlzJYQBmT-kF4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Personal Finance &amp; Financial discipline should be a mandatory subject in today&#39;s education system🙏thank you for such valuable content",
                            "textOriginal": "Personal Finance & Financial discipline should be a mandatory subject in today's education system🙏thank you for such valuable content",
                            "authorDisplayName": "@rounakUWU",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_kgeb3tvIBGrdY-IdjHykSG-MSKpwcehWUAO3_O6TXPgadO46BAk4RkoG8qNgXDJBfHxg=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@rounakUWU",
                            "authorChannelId": {
                                "value": "UCIGrfqEWvkjwIfU_8kSIDpQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 1,
                            "publishedAt": "2024-12-27T23:06:00Z",
                            "updatedAt": "2024-12-27T23:06:00Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "6_93y5jiSCl5Z9bL4YByWKPo15M",
                "id": "UgyL3lYdNTqalHiEv9x4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "cbV43K3lsnNpW7SBisBvM5cGuaw",
                        "id": "UgyL3lYdNTqalHiEv9x4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "I think the new generation is less to blame than the government that keeps printing money stealing purchasing power from common people.",
                            "textOriginal": "I think the new generation is less to blame than the government that keeps printing money stealing purchasing power from common people.",
                            "authorDisplayName": "@aakashnandi8202",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_mNRmkn7sCKauPGPQIpF0dgo6NWnA6Jfmc7C04DxUqr6Q8=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@aakashnandi8202",
                            "authorChannelId": {
                                "value": "UCpSbC1saOB1D1rsg4BcavEw"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T20:57:04Z",
                            "updatedAt": "2024-12-27T20:57:04Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "H6oR1O0seFVCbwEVZdwaDUf2IN4",
                "id": "UgzP4ya3W9q91w7fts14AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "mZ60jcJn43YjDq_tHBnAu-ONIW0",
                        "id": "UgzP4ya3W9q91w7fts14AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "<a href=\"https://www.youtube.com/watch?v=8iaaeTDTO9E&amp;t=587\">9:47</a> 👏👏",
                            "textOriginal": "9:47 👏👏",
                            "authorDisplayName": "@harishrawat6097",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_nwUFHxyK2grRvMqZQ8DKSE25fUrpWR7FeOFAo3LAgfVxo=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@harishrawat6097",
                            "authorChannelId": {
                                "value": "UCFiFGOSAV2WtO0N8jwb1SVg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 2,
                            "publishedAt": "2024-12-27T20:52:40Z",
                            "updatedAt": "2024-12-27T20:52:40Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "acgB0LGAVItcsU9iErQFCvaPPBc",
                "id": "UgwY_1kcPo5D6H3qiVR4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "NARIvynabTk7ZOjngiq7z1hCCh8",
                        "id": "UgwY_1kcPo5D6H3qiVR4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "I know this is off topic but where can I find that wallpaper on your monitor?",
                            "textOriginal": "I know this is off topic but where can I find that wallpaper on your monitor?",
                            "authorDisplayName": "@anveshverma4116",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_mN456jA1bfjcgUysWbz5n44HCfvo6DoWQSEHhJoAHRgdY=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@anveshverma4116",
                            "authorChannelId": {
                                "value": "UCp9Lfq_0hhsefTjpBv-aSqQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T20:44:10Z",
                            "updatedAt": "2024-12-27T20:44:10Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "4UubHVdRGszPdUUkRXT4uXD7FX8",
                "id": "UgwminAlO8ivOqRpyRd4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "nAC6w4bYOE-p3eA4bqfDkzwPIIs",
                        "id": "UgwminAlO8ivOqRpyRd4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "I heard stories from my dadi ma how she restarted her life after India’s partition. At that time, she started her life all over with 8 kids. <br>What I learned<br>1. You don’t need as much is advertise on media<br>2. All you need to cover body : few clothes. <br>3. Do not need to shop every year for objects and clothes<br>4. Save money<br>5. Live with in your chadar<br>6. Grass is always greener on the other side, so do what you have to do for your life<br>7.  My dadi Ma’s favorite line, kisi da karza nayi dena asi”",
                            "textOriginal": "I heard stories from my dadi ma how she restarted her life after India’s partition. At that time, she started her life all over with 8 kids. \nWhat I learned\n1. You don’t need as much is advertise on media\n2. All you need to cover body : few clothes. \n3. Do not need to shop every year for objects and clothes\n4. Save money\n5. Live with in your chadar\n6. Grass is always greener on the other side, so do what you have to do for your life\n7.  My dadi Ma’s favorite line, kisi da karza nayi dena asi”",
                            "authorDisplayName": "@Gaumukh",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/5pAV36SPgG59Fvf-BDisfnrOh9Cx27UaU7cNhhFYcD7FK-XznXTwTR1XL99zokTloj11mbYt=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@Gaumukh",
                            "authorChannelId": {
                                "value": "UCezibK2pVeoVLn4h4U6Br5w"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 8,
                            "publishedAt": "2024-12-27T20:39:38Z",
                            "updatedAt": "2024-12-27T20:39:38Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 2,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "EmGThuQYjW8TLJlbTv0GNdnsryE",
                "id": "Ugw34ONYWvNR_R7bxRx4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "WtJsMunFMeAHy031OKafeeO8jgI",
                        "id": "Ugw34ONYWvNR_R7bxRx4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "<a href=\"https://www.youtube.com/watch?v=8iaaeTDTO9E&amp;t=535\">8:55</a> I loved this part so bad!!",
                            "textOriginal": "8:55 I loved this part so bad!!",
                            "authorDisplayName": "@gadgettrendsarkar2050",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_l9mUzI_NxgD0QBFcdEr5-Ww7y0X9_2g8r6cIXwJ-U=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@gadgettrendsarkar2050",
                            "authorChannelId": {
                                "value": "UCHSVIx1c34t-7Y7JQUu_4fg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 2,
                            "publishedAt": "2024-12-27T20:06:34Z",
                            "updatedAt": "2024-12-27T20:06:34Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "dpWjNG7tiV8EApc36pBHwUhkFBA",
                "id": "UgzT_zy4Yzfn37CFtnZ4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "0lUeJWHfveel8yBHUTejC5QaOSs",
                        "id": "UgzT_zy4Yzfn37CFtnZ4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Basket me marijuana leaf",
                            "textOriginal": "Basket me marijuana leaf",
                            "authorDisplayName": "@himanshushekhar1400",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_ksl_oK3CY93a3U5dSfNRN1rlAnprXI9x19hRTeMavT91oK=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@himanshushekhar1400",
                            "authorChannelId": {
                                "value": "UCvrLbPE4M92TJCdxVn50CcA"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 1,
                            "publishedAt": "2024-12-27T20:01:45Z",
                            "updatedAt": "2024-12-27T20:01:45Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "G98TuUNl6ScUV2njD10FfYqCnoI",
                "id": "UgzXPK8jEszW0asSc1J4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "_g7U95s7yIVmcP4epwEktt73Okw",
                        "id": "UgzXPK8jEszW0asSc1J4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Eye-Opener! Young Generation is totally screwed, being 25 I feel i am getting in this trap too.",
                            "textOriginal": "Eye-Opener! Young Generation is totally screwed, being 25 I feel i am getting in this trap too.",
                            "authorDisplayName": "@rajchheda6947",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_kzN4t7haQ50l4N0zbHabArDyDXojRv7JW4WqXaLnpcgeAS=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@rajchheda6947",
                            "authorChannelId": {
                                "value": "UCOXn4I8bx7V3gagGfpDr9QA"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T19:54:02Z",
                            "updatedAt": "2024-12-27T19:54:02Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "1iBue9yi6YQc1NNderYrNYYwDAo",
                "id": "Ugyj3trWD58nVwQ7qVF4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "_ciyKcXZ9ojFzks77oyoNYPxfeE",
                        "id": "Ugyj3trWD58nVwQ7qVF4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "pls ,share that wallpaper?",
                            "textOriginal": "pls ,share that wallpaper?",
                            "authorDisplayName": "@ashishtanwar9748",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_n5cqYQO640UQafDWI2HD0HymuYZ3_ow7hgiTkr20ifazo=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@ashishtanwar9748",
                            "authorChannelId": {
                                "value": "UCxU6E1vYOk4FS1BMUwlsB6w"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T19:23:10Z",
                            "updatedAt": "2024-12-27T19:23:10Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "xAoM9mfOKG0Ra867_z6t8ch59I0",
                "id": "UgwJIGAudcg_V_1t6oF4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "XPFudmbHal1rk6iGh9T5q9s7bVo",
                        "id": "UgwJIGAudcg_V_1t6oF4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "No marketing will work on you when you make up your mind to find fulfilment in what you have. None of us are happy wearing that old tshirt from 3 years back. But it&#39;s okay when you make yourself feel okay. The next pair of shoes and the next shades isn&#39;t necessary unless you regret not &quot;gifting&quot; yourself enough and end up buying it. The same thing goes with young people taking huge home loan/car loan to fulfill their parents dreams to live like crorepati. This is the reason why 90% of Mumbai is owned by banks while the local commuters live in a dream that they&#39;re crorepati since they&#39;re the one paying EMi for the next 30 years or so. Another trap is living in foreign countries where young people take massive loans to go in a country where it&#39;s already very hard to get a job. Remember, earning good money is only half the battle, keeping the money is the second half of the battle. Mark my words here are &quot;keeping&quot; not &quot;investing&quot;. While investing in itself is not bad, but anyone below $10k in a bank account shouldn&#39;t risk investment. Start investment only when you don&#39;t care about losing the money. I advise to keep atleast $100k in bank but I know many people don&#39;t have patience so atleast $10k should suffice for any urgency.",
                            "textOriginal": "No marketing will work on you when you make up your mind to find fulfilment in what you have. None of us are happy wearing that old tshirt from 3 years back. But it's okay when you make yourself feel okay. The next pair of shoes and the next shades isn't necessary unless you regret not \"gifting\" yourself enough and end up buying it. The same thing goes with young people taking huge home loan/car loan to fulfill their parents dreams to live like crorepati. This is the reason why 90% of Mumbai is owned by banks while the local commuters live in a dream that they're crorepati since they're the one paying EMi for the next 30 years or so. Another trap is living in foreign countries where young people take massive loans to go in a country where it's already very hard to get a job. Remember, earning good money is only half the battle, keeping the money is the second half of the battle. Mark my words here are \"keeping\" not \"investing\". While investing in itself is not bad, but anyone below $10k in a bank account shouldn't risk investment. Start investment only when you don't care about losing the money. I advise to keep atleast $100k in bank but I know many people don't have patience so atleast $10k should suffice for any urgency.",
                            "authorDisplayName": "@mikemjlove4988",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_lHrN-w1GCSb_c9qdnQleSHZi13-OM6Mpn3PUz-K9VAoKM=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@mikemjlove4988",
                            "authorChannelId": {
                                "value": "UClIO8RvYOW8CDJ1tH1SRTOg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T19:19:26Z",
                            "updatedAt": "2024-12-27T19:19:26Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "It-4ydLso0FJEciI4VacP4PzKWw",
                "id": "UgzST9LXNhafaJdlUw94AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "ZSCunGNF6W9k78DebRI-9dhclkI",
                        "id": "UgzST9LXNhafaJdlUw94AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Thanks for another great content team ..",
                            "textOriginal": "Thanks for another great content team ..",
                            "authorDisplayName": "@jayadevtn1987",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_nQWtDjnkGaIYmOsk65bxLAmt6sDD9KGCnr9j4CzKha7Ht707dqW4PbsI-coFFXsWHIFA=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@jayadevtn1987",
                            "authorChannelId": {
                                "value": "UCAPfHp21kg76wsgFD3ZvfAA"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T19:12:08Z",
                            "updatedAt": "2024-12-27T19:12:08Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "iDLAh3Hbg7kKwG9I5dG9IV1KEQI",
                "id": "UgzhVuL48XlY3bQi7ph4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "zFHPjxdtt-06OnyVOChwH4jTcqk",
                        "id": "UgzhVuL48XlY3bQi7ph4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "How come they be rich in 23 age??",
                            "textOriginal": "How come they be rich in 23 age??",
                            "authorDisplayName": "@QuizDevi",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/k7CEPH2F80u5zAKmtLu0XeemmCPhTVkfBxhrlSSUR5aGn0XKCO-B3udfQ5EDoNZhycqeSmPm=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@QuizDevi",
                            "authorChannelId": {
                                "value": "UCCar2AjoX_N97ouWQRRiBqw"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T19:11:37Z",
                            "updatedAt": "2024-12-27T19:11:37Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "vLlteMrOcrBXlaFNJjYmzltgcB8",
                "id": "Ugx7ef9KnCMJnMvdPQN4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "3r8SFNIkiXTEhNL9GP4vzrKTj8c",
                        "id": "Ugx7ef9KnCMJnMvdPQN4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Very well said Sir. Adding to inflation, taxes (both direct and indirect) are heavily imposed on us which is taking away our future power of buying.",
                            "textOriginal": "Very well said Sir. Adding to inflation, taxes (both direct and indirect) are heavily imposed on us which is taking away our future power of buying.",
                            "authorDisplayName": "@rushikeshganne",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_ksowyu1shDrv4--ILS9EkAK--4LqENWWr3sCK1g8zr6ZY=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@rushikeshganne",
                            "authorChannelId": {
                                "value": "UCyKGv2_KWrmz5CTI0cdl9og"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T19:11:27Z",
                            "updatedAt": "2024-12-27T19:11:27Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "SQ5_CnWRwS8aVMVNzSVO8ydl8bs",
                "id": "UgzbnFMtqXu_BkeqQOZ4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "QBh_szgVdavw7Gk3XFCwkmJ2yTs",
                        "id": "UgzbnFMtqXu_BkeqQOZ4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "That is all fine, but is Siya single?",
                            "textOriginal": "That is all fine, but is Siya single?",
                            "authorDisplayName": "@ashwina.vardhan5831",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_kphkLRQWv9Ub8NgdJoKU7FOJGaUnMWDVRSjBnr6jdKchs=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@ashwina.vardhan5831",
                            "authorChannelId": {
                                "value": "UCgBCXnsp-40DI_qpIfu9vKg"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 1,
                            "publishedAt": "2024-12-27T19:06:10Z",
                            "updatedAt": "2024-12-27T19:06:10Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "LSJXnnL6SeMp0HT3MoI0jCQjZRE",
                "id": "UgyFRgcT1cTZN4_hX1R4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "xyLOK34f2vseMjGyxs93FVLOcJI",
                        "id": "UgyFRgcT1cTZN4_hX1R4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Good work ❤<br>Keep Enlightening everyone ❤",
                            "textOriginal": "Good work ❤\nKeep Enlightening everyone ❤",
                            "authorDisplayName": "@CubeTitles",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_mpKx_78Igo2lIF0Gs0yC5h68E1wXe8icKzMcXBO8mX3pc=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@CubeTitles",
                            "authorChannelId": {
                                "value": "UCgEW3_JsxqAdyAZbusCHP7w"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T19:04:52Z",
                            "updatedAt": "2024-12-27T19:04:52Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "1e4TOcn22QWO3YDrQP6mLsgHH6Q",
                "id": "UgzDCQ42dFzeDlGtxmx4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "fsCPytPthnkDmWN8ya445OX9qP0",
                        "id": "UgzDCQ42dFzeDlGtxmx4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Vai ne bacha liya. i was planning to buy Iphone but nah not now 😷",
                            "textOriginal": "Vai ne bacha liya. i was planning to buy Iphone but nah not now 😷",
                            "authorDisplayName": "@tashdidalam9657",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_km_pQbkGrB6NfPa8dhcsLfE7dkRlWY1V2zELCir6M3D7I=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@tashdidalam9657",
                            "authorChannelId": {
                                "value": "UCUR0itGJXAQFAvf_jx6oXFw"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T19:04:45Z",
                            "updatedAt": "2024-12-27T19:04:45Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "w-XUtBLrEOiQkMSmz4ki0WOLUV8",
                "id": "UgxZ6NLSfyUQZPzUXVJ4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "-aRhbtMp1q4X4BZ7XwcpPhZj_es",
                        "id": "UgxZ6NLSfyUQZPzUXVJ4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "why does the basket have cannabis <a href=\"UCkszU2WH9gy1mb0dV-11UJg/KsIfY6LzFoLM6AKanYDQAg\"></a>",
                            "textOriginal": "why does the basket have cannabis ",
                            "authorDisplayName": "@shamanthkiran8913",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_nnWyI9ZIwY8XwzFa-TgG_Z95jdIMXQuPsgareOa-NCcu6-s_gUG77pfFi_biP2zhc2jQ=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@shamanthkiran8913",
                            "authorChannelId": {
                                "value": "UCkP8Mrmpqacaqgfl4PxjL7Q"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T18:45:13Z",
                            "updatedAt": "2024-12-27T18:45:13Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "228Mh41hm4rpwjrTID-rVVNf104",
                "id": "UgwlWnUhdYgmsv5yzUx4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "VkPQxVLlYAfhlsqcVVpBtfJZ6lM",
                        "id": "UgwlWnUhdYgmsv5yzUx4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Are you guys bought?<br><br>Are you pushing some propaganda?<br><br>Why do I see four more videos pop up on the same damn topic, uploaded on the same day by other major Indian YT channels.",
                            "textOriginal": "Are you guys bought?\n\nAre you pushing some propaganda?\n\nWhy do I see four more videos pop up on the same damn topic, uploaded on the same day by other major Indian YT channels.",
                            "authorDisplayName": "@moyezrabbani637",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_nimnbqLgd6lw_ztQMumMODES2QIjq5LHJ_a6RXseR7HRgW=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@moyezrabbani637",
                            "authorChannelId": {
                                "value": "UCpd5TSiaz1rDTGj9YQo1WIQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T18:31:18Z",
                            "updatedAt": "2024-12-27T18:31:18Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "Np2bkeve8mfA1kWJsloa4GGckJs",
                "id": "UgzKhwrsidHRP_RJI8V4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "AQL8flmLQwjz9vcmojBDK97du5E",
                        "id": "UgzKhwrsidHRP_RJI8V4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Only impulse buying. Add Income tax and GST and inflation which is taking maximum share of our income",
                            "textOriginal": "Only impulse buying. Add Income tax and GST and inflation which is taking maximum share of our income",
                            "authorDisplayName": "@AbhishekSingh-jk8si",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_nVgfTZ3K-Tj2r9ug0nSCW-6fYBSR0DtFkUT8C01o8_1g=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@AbhishekSingh-jk8si",
                            "authorChannelId": {
                                "value": "UCHirg4GeGKq1eDaBxELdLZQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T18:17:14Z",
                            "updatedAt": "2024-12-27T18:17:14Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "MU3QYbYm170CGnRSSMwCEurCTbk",
                "id": "UgxTkOBAyp606NQTjv14AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "zE5dfqCPa8WoKFjcdRekij7Xnt0",
                        "id": "UgxTkOBAyp606NQTjv14AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "12 is a very very less number to create any hypothesis",
                            "textOriginal": "12 is a very very less number to create any hypothesis",
                            "authorDisplayName": "@AkS_Miasmin",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/9rXEOjErGAVRs_5zHI6QHXYbt0x2L3MZ4ziKm-xaCRJUgsGSxgGeJgiutBVzt42IE5-UKPQPQg=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@AkS_Miasmin",
                            "authorChannelId": {
                                "value": "UCfkYyu765HgzICeIXcXKnvA"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T18:07:52Z",
                            "updatedAt": "2024-12-27T18:07:52Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "T8sGLcTQpVsZGGnSU8p9Dgn8FTI",
                "id": "UgyPkLft_1ZjR-5ygp54AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "cUIiF5SIo4uTg4u-A8ahsDLNQMw",
                        "id": "UgyPkLft_1ZjR-5ygp54AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Abhi Niyu also shared same video today 🤣",
                            "textOriginal": "Abhi Niyu also shared same video today 🤣",
                            "authorDisplayName": "@ranadeepghosh",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_m0vSXxkkhI54kscxhbDshJ23rS-0j7euV1d52BOU-yhmQd=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@ranadeepghosh",
                            "authorChannelId": {
                                "value": "UC7DbxYS7xm4FrUUoWdySMJw"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T18:06:39Z",
                            "updatedAt": "2024-12-27T18:06:39Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 1,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "85lrLCu2TEx7urYXKDqZNzfRIco",
                "id": "Ugzm3tTR8ejsgHR6r3p4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "lnUmPk-nSHCgypRdvgyboHWZyjE",
                        "id": "Ugzm3tTR8ejsgHR6r3p4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Thank you ❤",
                            "textOriginal": "Thank you ❤",
                            "authorDisplayName": "@sunilkumarkatta9062",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_nB6WM9dZCuYr_I7oJxMu_ivCMYAgar37QllV4PYIE=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@sunilkumarkatta9062",
                            "authorChannelId": {
                                "value": "UCHWmAU48gGgfzAEwmBO2FYQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T18:06:01Z",
                            "updatedAt": "2024-12-27T18:06:01Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "C1ETuwfgW-l7WDZO9GnK9GRfxKM",
                "id": "UgzbxLRg4TF6gByN0ON4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "cjVHVC7bMebpEkasuLpwi8VByaM",
                        "id": "UgzbxLRg4TF6gByN0ON4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Great content!",
                            "textOriginal": "Great content!",
                            "authorDisplayName": "@ritakalpachakraborty4815",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_lS25kdQFUAQMwrh70AQGKTgJobeBjR4O6r7dIBQ4tXF_3e=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@ritakalpachakraborty4815",
                            "authorChannelId": {
                                "value": "UCCT18Nv5s-F7QDIkFlIImow"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 1,
                            "publishedAt": "2024-12-27T17:59:55Z",
                            "updatedAt": "2024-12-27T17:59:55Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "IzoBp08aWqJ-d8x0TqkQHg4fQ5s",
                "id": "UgykaGbHfH-lEAapse94AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "A6FPK1o7m7I2xYjktpfXDXK-lDM",
                        "id": "UgykaGbHfH-lEAapse94AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "just use hard cash, every thing will be sorted.",
                            "textOriginal": "just use hard cash, every thing will be sorted.",
                            "authorDisplayName": "@nikhilkumar-YT",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_l_UiCrm0JrJ9OQztynC_cI719ZFgo5Zqh0jr83jyQX0w=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@nikhilkumar-YT",
                            "authorChannelId": {
                                "value": "UCe7lrY0eD4KBz9PLaWFWctQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T17:33:00Z",
                            "updatedAt": "2024-12-27T17:33:00Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "25V1WiH7ENZDlOb-CsRjUctRBVA",
                "id": "UgwcgyQrq1B3yAz2JgZ4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "kkOllSvralrx64fqMgKeBdSL8Vs",
                        "id": "UgwcgyQrq1B3yAz2JgZ4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "It is not entirely the mistake of the generation. I remember in the &#39;90s my father was just a day-to-day wage worker. He could have a house. Have two kids feed three mouths at house thereafter sent me to a CBSE school. And today the inflation is so much getting a proper housing or even meeting the smallest of luxuries. Your salary is nothing considering this expenditure.",
                            "textOriginal": "It is not entirely the mistake of the generation. I remember in the '90s my father was just a day-to-day wage worker. He could have a house. Have two kids feed three mouths at house thereafter sent me to a CBSE school. And today the inflation is so much getting a proper housing or even meeting the smallest of luxuries. Your salary is nothing considering this expenditure.",
                            "authorDisplayName": "@pokerboy72",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/wxnqg9YEAYS_DXFJy-sNdgATmEpK0NGUVJ_7HxzvObpClDKlFhWpONm7EyZZTcDCc3C0K6ra=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@pokerboy72",
                            "authorChannelId": {
                                "value": "UCGe3vOeb7S7DpODsmCUqolw"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 2,
                            "publishedAt": "2024-12-27T17:30:14Z",
                            "updatedAt": "2024-12-27T17:30:44Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 3,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "EbW1SeLw-IgIxtjQWDFEvO-snPE",
                "id": "Ugyvr4SfmjVZpnD0RAl4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "hfQjA7AXxLjYoGC5aPBdLs3e2WY",
                        "id": "Ugyvr4SfmjVZpnD0RAl4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Low testosterone generation",
                            "textOriginal": "Low testosterone generation",
                            "authorDisplayName": "@jatin.patil777",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_ngypvX3Hyp27D5OPwyUG20NtV1a46e-lrh9IFtplTe84M=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@jatin.patil777",
                            "authorChannelId": {
                                "value": "UCCOM4TBxHNKcHq9DWq7mTSA"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T17:29:15Z",
                            "updatedAt": "2024-12-27T17:29:15Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "s6ANupCFdl5juuIFk10_0LFvEIQ",
                "id": "Ugyd2JDfz9L0l9SQ8tN4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "IUFADd2n2miMY7-cKkqR1_xJFNA",
                        "id": "Ugyd2JDfz9L0l9SQ8tN4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "inflation is 12-15%<br>and if we consider them separately food is 25%",
                            "textOriginal": "inflation is 12-15%\nand if we consider them separately food is 25%",
                            "authorDisplayName": "@thanmayrambr4979",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_nWfqskljcoQ1JdfUJ7xYzXFYOzBMun4jPRxD3B562NdcI=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@thanmayrambr4979",
                            "authorChannelId": {
                                "value": "UChDyTGXu1ksIQgJO0A1ubLQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T17:18:45Z",
                            "updatedAt": "2024-12-27T17:19:43Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "srxTWbnJ4I0R5FlQrtALDiq_fMQ",
                "id": "Ugw-pcd1IzIo62ncpQh4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "GU1HCClzjA6FIqkQCsb2qT7ACbA",
                        "id": "Ugw-pcd1IzIo62ncpQh4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Earning 2 lakh a month and at months end 0₹ right now here after buying legion go 😢",
                            "textOriginal": "Earning 2 lakh a month and at months end 0₹ right now here after buying legion go 😢",
                            "authorDisplayName": "@Amitdas-gk2it",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_kVtXpW3j-tifN84HUo1iV6Rn9bLU_TpV-grwzggDxs_Gk=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@Amitdas-gk2it",
                            "authorChannelId": {
                                "value": "UC2dp_NDL3Y3wH2hJ5GlMdgA"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T17:17:58Z",
                            "updatedAt": "2024-12-27T17:17:58Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "7ZI0mW3B2xWahp8Qxe0qF3DEgs0",
                "id": "Ugz9QpR1fD4jkYZd6_h4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "fbS23dR6A5EMYnYPux5G4GPiXw8",
                        "id": "Ugz9QpR1fD4jkYZd6_h4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "<a href=\"https://www.youtube.com/watch?v=8iaaeTDTO9E&amp;t=625\">10:25</a> sums up the video",
                            "textOriginal": "10:25 sums up the video",
                            "authorDisplayName": "@sujaynis3905",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_n5eJyB1CY-Nyx38jF1X5xS7xZm9hQW988tseebt7ajoIRU=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@sujaynis3905",
                            "authorChannelId": {
                                "value": "UCUxj8txFB_yhMLLtozw_DqA"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T17:17:27Z",
                            "updatedAt": "2024-12-27T17:17:27Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "o0TJcvwA9TKUH3PMtwTzUNCirw8",
                "id": "UgxjacacVwhdlSkvKd54AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "gbbRWinlWtviGFH_YaPQxOfctwI",
                        "id": "UgxjacacVwhdlSkvKd54AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "<a href=\"https://www.youtube.com/watch?v=8iaaeTDTO9E&amp;t=600\">10:00</a> bro become tyler",
                            "textOriginal": "10:00 bro become tyler",
                            "authorDisplayName": "@SuperxtemperedGlass",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/MSooc3jXq2QABOJynrFneRlMV69fyJjaXTbDiax4CraPpX3N1s6Dqz_HipPhSkc8ZUOYOQCs=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@SuperxtemperedGlass",
                            "authorChannelId": {
                                "value": "UCMRNXZNSiriSvscBKGfyhsA"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T17:17:24Z",
                            "updatedAt": "2024-12-27T17:17:24Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "yL_WHSgHg8A8O-wVPQZuIfi73P0",
                "id": "UgzcDNoXgUPRpq3CSrJ4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "e_xb6ChvDfSlXqaS6lv8qL2sfjk",
                        "id": "UgzcDNoXgUPRpq3CSrJ4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "<a href=\"https://www.youtube.com/watch?v=8iaaeTDTO9E&amp;t=191\">3:11</a><br>buy ad blockers and pay premium to all thing u see so that u don&#39;t see ads and u will not see ads",
                            "textOriginal": "3:11\nbuy ad blockers and pay premium to all thing u see so that u don't see ads and u will not see ads",
                            "authorDisplayName": "@thanmayrambr4979",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AIdro_nWfqskljcoQ1JdfUJ7xYzXFYOzBMun4jPRxD3B562NdcI=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@thanmayrambr4979",
                            "authorChannelId": {
                                "value": "UChDyTGXu1ksIQgJO0A1ubLQ"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 0,
                            "publishedAt": "2024-12-27T17:14:40Z",
                            "updatedAt": "2024-12-27T17:14:40Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            },
            {
                "kind": "youtube#commentThread",
                "etag": "SDc-uYBdPrpbXmkbCpaZa-6nV34",
                "id": "UgyqzgouiP0HySPg4pp4AaABAg",
                "snippet": {
                    "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                    "videoId": "8iaaeTDTO9E",
                    "topLevelComment": {
                        "kind": "youtube#comment",
                        "etag": "ZvtTnvp1SCiueO_a5H3LteHuMy4",
                        "id": "UgyqzgouiP0HySPg4pp4AaABAg",
                        "snippet": {
                            "channelId": "UCUUlw3anBIkbW9W44Y-eURw",
                            "videoId": "8iaaeTDTO9E",
                            "textDisplay": "Damn, the thumbnail was really good !! Made me click it and hooked on for the whole video.",
                            "textOriginal": "Damn, the thumbnail was really good !! Made me click it and hooked on for the whole video.",
                            "authorDisplayName": "@praneetpawar4784",
                            "authorProfileImageUrl": "https://yt3.ggpht.com/yNrjDJT5HWIyOmzpaDMXL2IDG5sPCnGs4VX0nTJtfoPRCXtx6oF0MA7xsm8BcWjOqHUMgEXlWQ=s48-c-k-c0x00ffffff-no-rj",
                            "authorChannelUrl": "http://www.youtube.com/@praneetpawar4784",
                            "authorChannelId": {
                                "value": "UCxCxZAsK-EmRsmskenRFLag"
                            },
                            "canRate": true,
                            "viewerRating": "none",
                            "likeCount": 4,
                            "publishedAt": "2024-12-27T17:14:12Z",
                            "updatedAt": "2024-12-27T17:14:12Z"
                        }
                    },
                    "canReply": true,
                    "totalReplyCount": 0,
                    "isPublic": true
                }
            }
        ]
    };

    return data;
}



