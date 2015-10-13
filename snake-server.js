var HTTP = require("http");
var WS = require("ws");

var config = {redirectUrl: "http://camerondm9.github.io/snake/", allowedOrigins: ["null", "http://camerondm9.github.io", "https://camerondm9.github.io"]};
var snake = {welcome: "Welcome", speed: 400, timer: null, chunkBits: 4, chunks: [], actors: [], actorIds: [], clients: []};
snake.chunkSize = 1 << snake.chunkBits;
snake.chunkMask = snake.chunkSize - 1;

snake.transmitChunk = function(chunk)
{
	chunk = (chunk || this);
	var message = null;
	if (chunk.changes.length)
	{
		//Send list of changes...
		message = JSON.stringify({x: chunk.x, y: chunk.y, s: chunk.changeStyles, u: chunk.changes});
		for (var i = 0; i < chunk.clients.length; i++)
		{
			try
			{
				chunk.clients[i].socket.send(message);
			}
			catch (ex)
			{
				//Remove failed client...
				chunk.clients.splice(i, 1);
				i--;
			}
		}
		chunk.changeStyles = [];
		chunk.changes = [];
	}
	if (chunk.newClients.length)
	{
		//Send indexed snapshot...
		var styles = [];
		var grid = [];
		for (var i = 0; i < snake.chunkSize; i++)
		{
			grid[i] = [];
			for (var j = 0; j < snake.chunkSize; j++)
			{
				var index = -1;
				for (var k = 0; k < styles.length; k++)
				{
					if (styles[k] == chunk.grid[i][j])
					{
						index = k;
						break;
					}
				}
				if (index < 0)
				{
					index = styles.length;
					styles.push(chunk.grid[i][j]);
				}
				grid[i][j] = index;
			}
		}
		message = JSON.stringify({x: chunk.x, y: chunk.y, s: styles, g: grid});
		for (var i = 0; i < chunk.newClients.length; i++)
		{
			try
			{
				chunk.newClients[i].socket.send(message);
				chunk.clients.push(chunk.newClients[i]);
			}
			catch (ex)
			{
				//Forget failed client...
			}
		}
		chunk.newClients = [];
	}
}

snake.updateChunk = function(x, y, style, chunk)
{
	chunk = (chunk || this);
	chunk.grid[x][y] = style;
	//Record changes...
	var index = -1;
	for (var i = 0; i < chunk.changeStyles.length; i++)
	{
		if (chunk.changeStyles[i] == style)
		{
			index = i;
			break;
		}
	}
	if (index < 0)
	{
		index = chunk.changeStyles.length;
		chunk.changeStyles.push(style);
	}
	chunk.changes.push(x | (y << snake.chunkBits) | (index << (2 * snake.chunkBits)));
}

snake.addChunk = function(x, y)
{
	var chunk = {x: x, y: y, clients: [], newClients: [], grid: [], changeStyles: [], changes: []};
	for (var i = 0; i < snake.chunkSize; i++)
	{
		chunk.grid[i] = [];
		for (var j = 0; j < snake.chunkSize; j++)
		{
			chunk.grid[i][j] = null;
		}
	}
	chunk.transmit = snake.transmitChunk;
	chunk.update = snake.updateChunk;
	snake.chunks.push(chunk);
	return chunk;
}

snake.transmitActor = function(actor)
{
	actor = (actor || this);
	var message = JSON.stringify({a: actor.id, x: actor.x, y: actor.y, s: actor.style, p: actor.path});
	for (var i = 0; i < snake.clients.length; i++)
	{
		if (actor != snake.clients[i])
		{
			try
			{
				snake.clients[i].socket.send(message);
			}
			catch (ex)
			{
				//Ignore...
			}
		}
		else
		{
			try
			{
				snake.clients[i].socket.send(JSON.stringify({a: -1, x: actor.x, y: actor.y}));
			}
			catch (ex)
			{
				//Ignore...
			}
		}
	}
}

snake.allocateActorId = function()
{
	for (var i = 0; i < snake.actorIds.length; i++)
	{
		if (!snake.actorIds[i])
		{
			snake.actorIds[i] = true;
			return i;
		}
	}
	var i = snake.actorIds.length;
	snake.actorIds[i] = true;
	return i;
}

snake.addActor = function(x, y, style)
{
	var actor = {id: snake.allocateActorId(), x: x, y: y, style: style, path: []};
	actor.transmit = snake.transmitActor;
	snake.actors.push(actor);
	return actor;
}

snake.plot = function(x, y, style, suggestion)
{
	//Try suggestion...
	if (suggestion && !suggestion.expired)
	{
		var offsetX = (suggestion.x * snake.chunkSize);
		var offsetY = (suggestion.y * snake.chunkSize);
		if ((offsetX <= x) &&
			((offsetX + snake.chunkSize) > x) && 
			(offsetY <= y) &&
			((offsetY + snake.chunkSize) > y))
		{
			suggestion.update(x - offsetX, y - offsetY, style);
			return suggestion;
		}
	}
	//Find correct chunk...
	for (var j = 0; j < snake.chunks.length; j++)
	{
		var chunk = snake.chunks[j];
		var offsetX = (chunk.x * snake.chunkSize);
		var offsetY = (chunk.y * snake.chunkSize);
		if ((offsetX <= x) &&
			((offsetX + snake.chunkSize) > x) && 
			(offsetY <= y) &&
			((offsetY + snake.chunkSize) > y))
		{
			chunk.update(x - offsetX, y - offsetY, style);
			return chunk;
		}
	}
	//Create new chunk...
	var chunk = snake.addChunk(Math.floor(x / snake.chunkSize), Math.floor(y / snake.chunkSize));
	chunk.update(x - (chunk.x * snake.chunkSize), y - (chunk.y * snake.chunkSize), style);
	return chunk;
}

snake.tick = function()
{
	//Move actors... (players)
	for (var i = 0; i < snake.actors.length; i++)
	{
		var actor = snake.actors[i];
		//Movement...
		if (actor.path.length > 0)
		{
			actor.direction = actor.path.shift();
		}
		switch (actor.direction)
		{
		case -1:
			//Don't move...
			break;
		case 0:
			actor.x -= 1;
			break;
		case 1:
			actor.y -= 1;
			break;
		case 2:
			actor.x += 1;
			break;
		case 3:
			actor.y += 1;
			break;
		default:
			//Skip plotting...
			continue;
		}
		//Plot point...
		actor.lastChunk = snake.plot(actor.x, actor.y, actor.style, actor.lastChunk);
		//Add to tail...
		if (actor.tail && (actor.direction !== null))
		{
			//Lengthen tail...
			while (actor.tail.path.length < actor.tailLength)
			{
				actor.tail.path.unshift(-1);
			}
			//Tail follows head...
			actor.tail.path.push(actor.direction);
		}
	}
	//Transmit changes...
	for (var i = 0; i < snake.chunks.length; i++)
	{
		snake.chunks[i].transmit();
	}
	//Transmit actors...
	for (var i = 0; i < snake.actors.length; i++)
	{
		snake.actors[i].transmit();
	}
	//Collect old chunks...
	
	//.....// Chunks that have no colored cells, no subscribers, and no actors do not need to be kept.....
}

//Create server to host game...
var server = HTTP.createServer(function(request, response)
{
	console.log((new Date()) + " Received request for " + request.url);
	if (config.redirectUrl)
	{
		response.writeHead(301, {Location: config.redirectUrl});
	}
	else
	{
		response.writeHead(404);
	}
	console.log("HTTP request was received!");
	response.end();
});

var wsServer = new WS.Server(
{
	server: server,
	verifyClient: function(info)
		{
			if (!info.origin)
			{
				return true;
			}
			for (var i = 0; i < config.allowedOrigins.length; i++)
			{
				if (config.allowedOrigins[i] == info.origin)
				{
					return true;
				}
			}
			console.log("Connection from '" + info.origin + "' was rejected!");
			return false;
		}
});

wsServer.on("connection", function(ws)
{
	var client = snake.addActor(Math.floor(Math.random() * 21) - 10, Math.floor(Math.random() * 21) - 10, "rgb(" + Math.floor(Math.random() * 255) + "," +  + Math.floor(Math.random() * 255) + "," +  + Math.floor(Math.random() * 255) + ")");
	client.path.push(-1);
	client.tailLength = 3;
	client.tail = snake.addActor(client.x, client.y, null);
	client.socket = ws;
	client.bad = 0;
	//Setup connection...
	ws.on("message", function(message, flags) {
		if (!flags.binary)
		{
			var data = JSON.parse(message);
			if (data)
			{
				if (data.hasOwnProperty("s"))
				{
					//Subscription update...
					var chunk = null;
					for (var i = 0; i < snake.chunks.length; i++)
					{
						if ((snake.chunks[i].x == data.x) && (snake.chunks[i].y == data.y))
						{
							chunk = snake.chunks[i];
							break;
						}
					}
					if (data.s)
					{
						//Add subscriber...
						if (!chunk)
						{
							chunk = snake.addChunk(data.x, data.y);
						}
						else
						{
							for (var j = 0; j < chunk.clients.length; j++)
							{
								if (chunk.clients[j] == client)
								{
									client.bad++;
									return;
								}
							}
							for (var j = 0; j < chunk.newClients.length; j++)
							{
								if (chunk.newClients[j] == client)
								{
									client.bad++;
									return;
								}
							}
						}
						chunk.newClients.push(client);
					}
					else
					{
						//Remove subscriber...
						if (chunk)
						{
							var found = false;
							for (var j = 0; j < chunk.clients.length; j++)
							{
								if (chunk.clients[j] == client)
								{
									chunk.clients.splice(j, 1);
									found = true;
									break;
								}
							}
							for (var j = 0; j < chunk.newClients.length; j++)
							{
								if (chunk.newClients[j] == client)
								{
									chunk.newClients.splice(j, 1);
									found = true;
									break;
								}
							}
							if (!found)
							{
								client.bad++;
							}
						}
						else
						{
							client.bad++;
						}
						try
						{
							ws.send(JSON.stringify({x: data.x, y: data.y}));
						}
						catch (ex)
						{
							//Ignore for now, not sure what should happen...
						}
					}
				}
				else if (data.hasOwnProperty("p"))
				{
					//Path update...
					if ((data.x == client.x) && (data.y == client.y))
					{
						//Replace entire path...
						client.path.length = 0;
						for (var i = 0; i < data.p.length; i++)
						{
							if ((data.p[i] >= 0) && (data.p[i] <= 3))
							{
								client.path.push(data.p[i]);
							}
						}
					}
					else
					{
						//Match tail...
						var lx = client.x;
						var ly = client.y;
						var found = -1;
						for (var i = (client.tail.path.length - 1); i >= 0; i--)
						{
							switch (client.tail.path[i])
							{
							case 0:
								lx += 1;
								break;
							case 1:
								ly += 1;
								break;
							case 2:
								lx -= 1;
								break;
							case 3:
								ly -= 1;
								break;
							default:
								continue;
							}
							if ((data.x == lx) && (data.y == ly))
							{
								found = i;
								break;
							}
						}
						if (found >= 0)
						{
							//Synchronize path...
							found = client.tail.path.length - found;
							while (found > 0)
							{
								data.p.shift();
								found--;
							}
							//Use as much path as possible...
							client.path.length = 0;
							for (var i = 0; i < data.p.length; i++)
							{
								if ((data.p[i] >= 0) && (data.p[i] <= 3))
								{
									client.path.push(data.p[i]);
								}
							}
						}
						else
						{
							//Match proposed path...
							var lx = client.x;
							var ly = client.y;
							for (var i = 0; i < client.path.length; i++)
							{
								switch (client.path[i])
								{
								case 0:
									lx -= 1;
									break;
								case 1:
									ly -= 1;
									break;
								case 2:
									lx += 1;
									break;
								case 3:
									ly += 1;
									break;
								default:
									continue;
								}
								if ((data.x == lx) && (data.y == ly))
								{
									found = i;
									break;
								}
							}
							if (found >= 0)
							{
								//Keep the matched section of path...
								client.path.length = found + 1;
								for (var i = 0; i < data.p.length; i++)
								{
									if ((data.p[i] >= 0) && (data.p[i] <= 3))
									{
										client.path.push(data.p[i]);
									}
								}
							}
							else
							{
								//Cannot match path... (just use it all, and hope for the best)
								client.path.length = 0;
								for (var i = 0; i < data.p.length; i++)
								{
									if ((data.p[i] >= 0) && (data.p[i] <= 3))
									{
										client.path.push(data.p[i]);
									}
								}
							}
						}
					}
				}
				else if (data.hasOwnProperty("l"))
				{
					client.tailLength += data.l;
				}
				else
				{
					console.log(message);
				}
			}
		}
	});
	ws.on("close", function(code, message) {
		console.log("Connection closed!");
		//Remove from global client list...
		for (var i = 0; i < snake.clients.length; i++)
		{
			if (snake.clients[i] == client)
			{
				snake.clients.splice(i, 1);
				break;
			}
		}
		//Don't worry about chunk subscriber lists... (client will fail and be removed)
		
	});
	//Send welcome message...
	try
	{
		ws.send(JSON.stringify({w: snake.welcome, b: snake.chunkBits, i: snake.speed}));
		ws.send(JSON.stringify({a: -1, x: client.x, y: client.y, s: client.style}));
		snake.clients.push(client);
	}
	catch (ex)
	{
		//Forget about connection...
	}
});

var server_port = process.env.OPENSHIFT_NODEJS_PORT || 8080;
var server_ip = process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1';
server.listen(server_port, server_ip);
snake.timer = setInterval(snake.tick, snake.speed);
