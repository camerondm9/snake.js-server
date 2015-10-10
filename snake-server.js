var HTTP = require("http");
var WS = require("ws");

var config = {redirectUrl: "", allowedOrigins: ["null"]};
var snake = {welcome: "Welcome", speed: 100, timer: null, chunkBits: 4, chunks: [], clients: []};
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
			chunk.clients[i].socket.send(message);
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
				for (var k = 0; k < snake.chunkSize; k++)
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
				chunk.grid[i][j] = index;
			}
		}
		message = JSON.stringify({x: chunk.x, y: chunk.y, s: styles, g: grid});
		for (var i = 0; i < chunk.newClients.length; i++)
		{
			chunk.newClients[i].socket.send(message);
			chunk.clients.push(chunk.newClients[i]);
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

snake.tick = function()
{
	for (var i = 0; i < snake.chunks.length; i++)
	{
		snake.chunks[i].transmit();
	}
}

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
	var client = {socket: ws, bad: 0, style: "rgb(" + Math.floor(Math.random() * 255) + "," +  + Math.floor(Math.random() * 255) + "," +  + Math.floor(Math.random() * 255) + ")"};
	//Setup connection...
	ws.on("message", function(message, flags) {
		if (!flags.binary)
		{
			var data = JSON.parse(message);
			if (data)
			{
				if (data.hasOwnProperty("s"))
				{
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
						ws.send(JSON.stringify({x: data.x, y: data.y}));
					}
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
	});
	//Send welcome message...
	ws.send(JSON.stringify({w: snake.welcome, b: snake.chunkBits, i: snake.speed}));
	ws.send(JSON.stringify({s: client.style}));
	snake.clients.push(client);
});

server.listen(8080);
snake.timer = setInterval(snake.tick, snake.speed);
