import csv, itertools 
p=r\"d:\bhuvan\E_Commerce_Customer_Churn_With_Support_Tickets.csv\" 
with open(p, newline=\"\", encoding=\"utf-8\") as f: 
    r=csv.reader(f) 
    for row in itertools.islice(r, 3): print(row) 
