package node

import (
	"fmt"
	"math/rand"
	"time"
)

var funnyNames = []string{
	"Cosmic Llama", "Turbo Snail", "Lazy Dragon", "Chunky Panda",
	"Sneaky Fox", "Dancing Bear", "Grumpy Cat", "Happy Whale",
	"Funky Monkey", "Sleepy Sloth", "Bouncy Rabbit", "Speedy Turtle",
	"Dizzy Penguin", "Brave Mouse", "Mighty Ant", "Tiny Elephant",
	"Wild Hamster", "Cool Dolphin", "Zen Tiger", "Epic Koala",
	"Flying Fish", "Silent Storm", "Thunder Bee", "Pixel Parrot",
	"Neon Gecko", "Crypto Crab", "Quantum Duck", "Galactic Goat",
	"Atomic Otter", "Stellar Squid", "Lunar Lynx", "Solar Seal",
	"Turbo Toucan", "Nitro Newt", "Mega Moose", "Ultra Unicorn",
	"Super Starfish", "Hyper Hawk", "Power Puffin", "Rocket Raccoon",
	"Blazing Buffalo", "Frozen Frog", "Electric Eel", "Magnetic Mole",
	"Phantom Phoenix", "Shadow Shark", "Crystal Cat", "Diamond Dog",
	"Golden Gorilla", "Silver Swan", "Bronze Bull", "Iron Ibis",
	"Copper Cobra", "Platinum Pelican", "Ruby Rhino", "Emerald Eagle",
	"Sapphire Snake", "Topaz Toad", "Amber Alpaca", "Jade Jaguar",
	"Onyx Owl", "Pearl Pig", "Opal Octopus", "Coral Crane",
	"Misty Mongoose", "Dusty Dingo", "Foggy Ferret", "Cloudy Chipmunk",
	"Rusty Robin", "Mossy Mantis", "Sandy Salamander", "Frosty Falcon",
	"Stormy Sparrow", "Windy Wolf", "Sunny Stork", "Rainy Raven",
	"Breezy Badger", "Dewy Dove", "Hazy Heron", "Smoky Scorpion",
	"Fluffy Flamingo", "Spiky Spider", "Stripey Zebra", "Spotted Seal",
	"Curly Camel", "Fuzzy Finch", "Shiny Starling", "Bumpy Beetle",
	"Wobbly Wombat", "Jiggly Jellyfish", "Wiggly Worm", "Squishy Squid",
	"Bubbly Bat", "Peppy Peacock", "Zesty Zebrafish", "Snappy Shrimp",
	"Cheery Chinchilla", "Jolly Jackal", "Perky Porcupine", "Quirky Quail",
}

// GenerateMoniker creates a random node moniker.
// Format: "BZE Hub - {funny_name} - {timestamp}"
func GenerateMoniker() string {
	name := funnyNames[rand.Intn(len(funnyNames))]
	ts := time.Now().UTC().Format("20060102-150405")
	return fmt.Sprintf("BZE Hub - %s - %s", name, ts)
}
