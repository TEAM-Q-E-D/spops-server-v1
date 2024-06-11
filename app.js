const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const dotenv = require('dotenv');
const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require('uuid');
const app = express();

dotenv.config(); // .env 파일 로드
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 8080;
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const ddbDocClient = DynamoDBDocumentClient.from(dynamoClient);
const matchTableName = process.env.MATCH_TABLE;
const queueTableName = process.env.QUEUE_TABLE;

const Queue = [];

async function initializeQueue() {
  const params = {
    TableName: queueTableName,
    Key: {
      place: "default" // 기본 플레이스 키
    }
  };

  try {
    const data = await ddbDocClient.send(new GetCommand(params));
    if (data.Item && data.Item.players) {
      Queue.push(...data.Item.players);
    }
  } catch (error) {
    console.error("Error initializing queue:", error);
  }
}

// 서버 시작 시 큐 초기화
initializeQueue();

async function addPlayer(place, playerName) {
  console.log(place, playerName);
  if (!playerName) {
    return { status: 400, message: "플레이어 이름을 제공하세요." };
  }

  Queue.push(playerName);
  await updateQueueInDynamoDB(place);
  return { status: 201, message: "플레이어가 추가되었습니다." };
}

function removePlayer(place, index) {
  console.log(place, index);
  if (index >= 0 && index < Queue.length) {
    Queue.splice(index, 1);
    updateQueueInDynamoDB(place);
    return { status: 200, message: "플레이어가 제거되었습니다." };
  }
  return { status: 404, message: "플레이어를 찾을 수 없습니다." };
}

async function updatePlayerName(place, index, newName) {
  console.log(place, index, newName);
  if (index >= 0 && index < Queue.length && newName.trim() !== "") {
    Queue[index] = newName.trim();
    await updateQueueInDynamoDB(place);
    return { status: 200, message: "플레이어 이름이 업데이트되었습니다." };
  }
  return { status: 404, message: "등록되지 않은 플레이어 이름입니다." };
}

async function updateQueueInDynamoDB(place) {
  const params = {
    TableName: queueTableName,
    Item: {
      place: place,
      players: Queue,
    },
  };

  try {
    await ddbDocClient.send(new PutCommand(params));
    console.log("Queue updated in DynamoDB:", Queue);
  } catch (error) {
    console.error("Error updating DynamoDB:", error);
  }
}

async function saveMatchResult(data) {
  const matchId = uuidv4();
  
  // 현재 시간 (UTC 기준)
  const now = new Date();
  
  // 서울 시간으로 변환 (UTC+9)
  const seoulTime = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  const date = seoulTime.toISOString();
  
  const player1Won = data.player1_score > data.player2_score;
  const winner = player1Won ? data.player1_name : data.player2_name;
  const loser = player1Won ? data.player2_name : data.player1_name;

  const params = {
    TableName: matchTableName,
    Item: {
      place: data.place,
      match_id: matchId,
      player1_name: data.player1_name,
      player1_score: data.player1_score,
      player2_name: data.player2_name,
      player2_score: data.player2_score,
      match_time: data.match_time,
      date: date,
      winner: winner,
      loser: loser,
    },
  };

  try {
    await ddbDocClient.send(new PutCommand(params));
    console.log("Match result saved:", params.Item);
  } catch (error) {
    console.error("Error saving match result:", error);
  }
}

app.get("/players", (req, res) => {
  res.json(Queue);
});

app.post("/players", async (req, res) => {
  const newPlayer = req.body.name;
  const place = req.body.place;
  const result = await addPlayer(place, newPlayer); // addPlayer 호출 시 await 추가
  res.status(result.status).json({ message: result.message });
});

app.delete("/players/:index", (req, res) => {
  const index = parseInt(req.params.index);
  const place = req.query.place;
  const result = removePlayer(place, index);
  res.status(result.status).json({ message: result.message });
});

app.put("/players/:index", async (req, res) => {
  const index = parseInt(req.params.index);
  const newName = req.body.newName;
  const place = req.body.place;
  const result = await updatePlayerName(place, index, newName);
  console.log(result);
  res.status(result.status).json({ message: result.message });
});

app.post("/result", async (req, res) => {
  const data = req.body;
  await saveMatchResult(data);
  res.status(201).json({ message: "경기 결과가 저장되었습니다." });
});

app.delete("/endCurrentGame", (req, res) => {
  const place = req.query.place;
  let placePlayers = Queue;

  if (placePlayers.length > 1) {
    Queue.splice(0, 2);
    updateQueueInDynamoDB(place);
    res.status(200).send("게임 종료");
  } else {
    res.status(400).send("대기 중인 플레이어가 부족합니다.");
  }
});

app.listen(port, () => {
  console.log(`서버가 ${port} 포트에서 실행 중입니다.`);
});
