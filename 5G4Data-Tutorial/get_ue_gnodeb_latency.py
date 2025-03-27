import random

# Estimate the latency from the UE to the attatched gNodeB. This latency is usually
# just a few milliseconds, depending on traffic load. Let us just estimate it with
# a random number between 4 and 11 milliseconds. Good enough for the MVS...

def get_random_number():
    return random.randint(4, 11)

# Example usage
random_number = get_random_number()
print("Latency between UE and 5G gnodeb:", random_number)
